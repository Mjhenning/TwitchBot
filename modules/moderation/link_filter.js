const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {config} = require("../../config");
const {withTokenRetry, refreshBotToken} = require("../../auth");
const {Logger} = require('../../services');

function loadConfig() {
    return JSON.parse(fs.readFileSync(config.MOD_CONFIG_PATH, "utf8"));
}

let moderationConfig = loadConfig();

function reloadConfig() {
    moderationConfig = loadConfig();
}

const LINK_REGEX =
    /(https?:\/\/[^\s]+|ftp:\/\/[^\s]+|www\.[^\s]+|(?:[\w-]+\.)+[a-z]{2,}[^\s]*)/gi;
let lastWarn = 0;

function extractLinks(message) {
    return message.match(LINK_REGEX) || [];
}

function normalize(link) {
    return link
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^ftp:\/\//, "")
        .replace(/^www\./, "");
}

function domainMatches(link, domains) {
    try {
        const host = new URL(
            link.startsWith("http") ? link : "https://" + link
        ).hostname.replace(/^www\./, "");
        return domains.some(domain =>
            host === domain || host.endsWith("." + domain)
        );
    } catch {
        return false;
    }
}

function isAllowedSongRequest(message, ssrEnabled) {
    if (!ssrEnabled)
        return false;
    const lower = message.toLowerCase();
    return moderationConfig.allowedCommands.some(cmd =>
        lower.startsWith(cmd.toLowerCase() + " ")
    );
}

function isTrustedUser(tags) {
    const badges = tags.badges || {};
    return moderationConfig.trustedBadges.some(badge => {
        switch (badge.toLowerCase()) {
            case "moderator":
            case "mod":
                return tags.mod;
            case "broadcaster":
                return badges.broadcaster === "1";
            default:
                return badges[badge] != null;
        }
    });
}

async function handleLinkBlocker(client, channel, tags, message, ssrEnabled, mrEnabled) {
    // Custom badge from config bypass
    if (isTrustedUser(tags))
        return false;
    const links = extractLinks(message);
    if (!links.length)
        return false;
    const srCommand = isAllowedSongRequest(message, ssrEnabled);
    for (const link of links) {
        // Always allowed
        if (domainMatches(link, moderationConfig.alwaysAllowedDomains))
            continue;
        // Allowed only while Song Requests are enabled
        if (srCommand && domainMatches(link, moderationConfig.songRequestDomains))
            continue;
        // Allowed while Media Requests are open, same domain list, different gate
        if (mrEnabled && domainMatches(link, moderationConfig.songRequestDomains))
            continue;
        return await block(client, channel, tags);
    }
    return false;
}

async function block(client, channel, tags) {
    try {
        await withTokenRetry(
            () => axios.delete(
                "https://api.twitch.tv/helix/moderation/chat",
                {
                    headers: {
                        "Client-ID": config.CLIENT_ID,
                        "Authorization": `Bearer ${config.BOT_ACCESS_TOKEN}`
                    },
                    params: {
                        broadcaster_id: config.BROADCASTER_ID,
                        moderator_id: config.BOT_ID,
                        message_id: tags.id
                    }
                }
            ),
            refreshBotToken
        );
        Logger.log("[Link Filter] Message deleted successfully.");
    } catch (err) {
        Logger.error("[Link Filter] Delete failed");
        if (err.response) {
            Logger.error(`${err.response.status}`);
            Logger.error(`${JSON.stringify(err.response.data, null, 2)}`);
        } else {
            Logger.error(`${err}`);
        }
    }
    const now = Date.now();
    if (now - lastWarn > moderationConfig.warnCooldown) {
        client.say(
            channel,
            `@${tags.username} please avoid posting links in chat. Links are not allowed in this channel unless they are part of a song request.`
        );
        lastWarn = now;
    }
    return true;
}

//---------------------VIDEO REDEEM URL VALIDATION---------------------

const PLAYLIST_RE = /[?&]list=/i;

class ValidationError extends Error {
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}

function extractRedeemUrl(userInput) {
    const links = extractLinks(userInput || "");
    if (!links.length) throw new ValidationError("no_url");

    const link = links[0];
    if (!domainMatches(link, moderationConfig.songRequestDomains)) {
        throw new ValidationError("wrong_site");
    }
    if (PLAYLIST_RE.test(link)) throw new ValidationError("playlist");

    return link.startsWith("http") ? link : `https://${link}`;
}

module.exports = {
    handleLinkBlocker,
    reloadConfig,
    extractRedeemUrl,
    ValidationError
};
const fs = require("fs");
const path = require("path");

const axios = require("axios");
const {config, withTokenRetry, refreshBotToken} = require("../../config");

const CONFIG_PATH = path.join(__dirname, "../../data/moderation.json");

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
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

async function handleLinkBlocker(client, channel, tags, message, ssrEnabled) {

    // Custom badge from config bypass
    if (isTrustedUser(tags))
        return false;

    const links = extractLinks(message);
    console.log("[Link Filter] Extracted links:", links);

    if (!links.length)
        return false;

    const srCommand = isAllowedSongRequest(message, ssrEnabled);
    console.log("[Link Filter]", {
        message,
        ssrEnabled,
        srCommand
    });

    for (const link of links) {

        console.log("[Link Filter] Checking", {
            link,
            allowed: domainMatches(link, moderationConfig.songRequestDomains)
        });

        // Always allowed
        if (domainMatches(link, moderationConfig.alwaysAllowedDomains))
            continue;

        // Allowed only while Song Requests are enabled
        if (
            srCommand &&
            domainMatches(link, moderationConfig.songRequestDomains)
        )
            continue;

        return await block(client, channel, tags);
    }

    return false;
}

async function block(client, channel, tags) {

    console.log("[Link Filter] Deleting message:");
    console.log("[Link Filter]", {
        messageId: tags.id,
        broadcasterId: config.BROADCASTER_ID,
        moderatorId: config.BOT_ID,
        botHasToken: !!config.BOT_ACCESS_TOKEN
    });

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

        console.log("[Link Filter] Message deleted successfully.");

    } catch (err) {

        console.error("[Link Filter] Delete failed");

        if (err.response) {
            console.error(err.response.status);
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err);
        }
    }

    const now = Date.now();

    if (now - lastWarn > moderationConfig.warnCooldown) {

        client.say(
            channel,
            `@${tags.username} Links aren't permitted here. YouTube links may only be posted through !sr while Song Requests are open. ✧`
        );

        lastWarn = now;
    }

    return true;
}

module.exports = {
    handleLinkBlocker,
    reloadConfig
};
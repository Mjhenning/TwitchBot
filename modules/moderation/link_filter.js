const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../../data/moderation.json");

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

let config = loadConfig();

function reloadConfig() {
    config = loadConfig();
}

const LINK_REGEX =
    /\b(?:https?:\/\/|ftp:\/\/|www\.|(?:[\w-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/gi;

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
    const value = normalize(link);

    return domains.some(domain => {
        const d = domain.toLowerCase();

        return (
            value === d ||
            value.startsWith(d + "/") ||
            value.startsWith(d + "?") ||
            value.startsWith(d + "#") ||
            value.endsWith("." + d)
        );
    });
}

function isAllowedSongRequest(message, ssrEnabled) {

    if (!ssrEnabled)
        return false;

    const lower = message.toLowerCase();

    return config.allowedCommands.some(cmd =>
        lower.startsWith(cmd.toLowerCase() + " ")
    );
}

function isTrustedUser(tags) {
    const badges = tags.badges || {};

    return config.trustedBadges.some(badge => {
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

    if (!links.length)
        return false;

    const srCommand = isAllowedSongRequest(message, ssrEnabled);

    for (const link of links) {

        // Always allowed
        if (domainMatches(link, config.alwaysAllowedDomains))
            continue;

        // Allowed only while Song Requests are enabled
        if (
            srCommand &&
            domainMatches(link, config.songRequestDomains)
        )
            continue;

        return await block(client, channel, tags);
    }

    return false;
}

async function block(client, channel, tags) {

    try {
        await client.deletemessage(channel, tags.id);
    } catch (err) {
        console.error("[Link Filter]", err.message);
    }

    const now = Date.now();

    if (now - lastWarn > config.warnCooldown) {

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
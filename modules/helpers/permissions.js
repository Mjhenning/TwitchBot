// modules/helpers/permissions.js
// Single source of truth for chat permission checks. tmi.js normalizes the
// mod tag to a boolean and keeps badges as strings, so centralize both here.
let lastDenied = 0;

function isModerator(tags) {
    return Boolean(tags?.mod);
}

function isBroadcaster(tags) {
    return tags?.badges?.broadcaster === '1';
}

function isModOrBroadcaster(tags) {
    return isModerator(tags) || isBroadcaster(tags);
}

function hasBadge(tags, badge) {
    return tags?.badges?.[badge] != null;
}

function requireMod(tags, client, channel) {
    if (!isModOrBroadcaster(tags)) {
        const now = Date.now();
        if (now - lastDenied > 5000) {
            client.say(channel, `Permission denied... this command is restricted ✧`);
            lastDenied = now;
        }
        return false;
    }
    return true;
}

module.exports = {isModerator, isBroadcaster, isModOrBroadcaster, hasBadge, requireMod};

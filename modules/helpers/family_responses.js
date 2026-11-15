// modules/helpers/family_responses.js

const fs = require("fs");

const {config} = require("../../config");

let familyConfig = loadFamilyConfig();

function loadFamilyConfig() {
    try {
        return JSON.parse(fs.readFileSync(config.FAMILY_PATH, "utf8"));
    } catch (err) {
        // missing or broken file means no special responses, chat keeps working
        return {};
    }
}

function reloadFamilyConfig() {
    familyConfig = loadFamilyConfig();
}

// resolve a typed name to a family group, or null for strangers
function familyGroupOf(name) {
    const n = (name || "").replace(/^@/, "").trim().toLowerCase();
    if (!n) return null;
    for (const [group, entry] of Object.entries(familyConfig)) {
        if ((entry.aliases || []).some(alias => String(alias).toLowerCase() === n)) {
            return group;
        }
    }
    return null;
}

// broadcaster, or one family member calling the other; self and strangers stay neutral
function familyAllowed(targetGroup, senderLogin, isBroadcaster) {
    if (!targetGroup) return false;
    if (isBroadcaster) return true;
    const senderGroup = familyGroupOf(senderLogin);
    return !!senderGroup && senderGroup !== targetGroup;
}

function render(template, senderName, target) {
    return String(template)
        .replace(/\$\{senderName\}/g, senderName)
        .replace(/\$\{target\}/g, target);
}

// neutral pool for everyone, family lines union-picked in for allowed senders
function pickFamilyPool(command, target, senderName, senderLogin, isBroadcaster) {
    const group = familyGroupOf(target);
    if (!group) return null;
    const entry = familyConfig[group];
    const pool = entry && entry[command];
    if (!Array.isArray(pool?.neutral)) return null;
    const allowed = familyAllowed(group, senderLogin, isBroadcaster);
    const templates = allowed ? pool.neutral.concat(pool.family || []) : pool.neutral;
    return templates.map(template => render(template, senderName, target));
}

module.exports = {
    familyGroupOf,
    familyAllowed,
    pickFamilyPool,
    reloadFamilyConfig
};

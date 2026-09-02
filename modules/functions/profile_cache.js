// modules/functions/profile_cache.js
// Small disk cache mapping userId -> Twitch profile info (display name + pfp)
// so the profile overlay only hits Helix when a user's data isn't cached.
const fs = require('fs');
const path = require('path');
const {Logger} = require('../../services');

const CACHE_PATH = path.join(__dirname, '../../data/profile_cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // pfps rarely change within a month

let cache = {};

function loadProfileCache() {
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) || {};
    } catch {
        Logger.warn('[ProfileCache] Creating new profile cache');
        cache = {};
    }
}

function saveProfileCache() {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[ProfileCache] Failed to save profile cache: ${err.message}`);
    }
}

function getProfile(userId) {
    const entry = cache[userId];
    if (!entry || entry.expires < Date.now()) return null;
    return entry;
}

function setProfile(userId, data) {
    cache[userId] = {...data, expires: Date.now() + CACHE_TTL_MS};
    saveProfileCache();
}

module.exports = {loadProfileCache, getProfile, setProfile};

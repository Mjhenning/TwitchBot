// modules/helpers/favourite_shoutout.js
// Auto-shouts out favourited streamers the first time they talk each stream.
// The favourites list is shared with the Discord bot and read from its JSON
// (config.FAVOURITES_FILE), so editing it once updates both bots.
const fs = require('fs');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {chatShoutout} = require('../functions/shoutout');

//-------------------STATE-------------------
const CACHE_TTL_MS = 30 * 1000; // reload the shared file at most every 30s

let greeted = new Set();     // userIds already shouted out this stream
let favourites = null;       // lowercased usernames from the shared JSON
let lastLoaded = 0;

//------------------FAVOURITES LIST------------------
function loadFavourites() {
    const now = Date.now();
    if (favourites && now - lastLoaded < CACHE_TTL_MS) return favourites;

    try {
        const raw = JSON.parse(fs.readFileSync(config.FAVOURITES_FILE, 'utf8'));
        favourites = new Set(Object.keys(raw).map(name => name.toLowerCase()));
    } catch (err) {
        Logger.warn(`[FavShoutout] Could not load favourites list (${err.message}), will retry`);
        favourites = favourites || new Set();
    }
    lastLoaded = now;
    return favourites;
}

//------------------CHECK ON MESSAGE------------------
async function checkFavouriteShoutout(client, channel, tags, senderName) {
    try {
        if (tags.badges?.broadcaster === '1') return; // never shoutout the host

        const userId = tags['user-id'];
        if (!userId || greeted.has(userId)) return;

        const login = (tags.username || '').toLowerCase();
        if (!loadFavourites().has(login)) return;

        greeted.add(userId);
        Logger.log(`[FavShoutout] First message from favourited user ${senderName}, shouting out`);
        await chatShoutout(client, config, login);
    } catch (err) {
        Logger.error(`[FavShoutout] Failed to shout out ${senderName}: ${err.message}`);
    }
}

// clears per-stream greeted state; called on bot start/stop
function resetFavouriteShoutout() {
    greeted = new Set();
    favourites = null;
    lastLoaded = 0;
}

module.exports = {checkFavouriteShoutout, resetFavouriteShoutout};
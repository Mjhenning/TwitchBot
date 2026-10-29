// modules/helpers/favourite_shoutout.js
// Auto-shouts out favourited streamers the first time they talk each stream.
// The favourites list is shared with the Discord bot and read from its JSON
// (config.FAVOURITES_FILE), so editing it once updates both bots.
const fs = require('fs');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {chatShoutout} = require('../functions/shoutout');
const {setGate, onRestoreGate} = require('./session_gates');
const {isBroadcaster} = require('./permissions');

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
        favourites = new Set();

        for (const [name, val] of Object.entries(raw)) {
            if (typeof val === 'string') {
                // old format: treat as both
                favourites.add(name.toLowerCase());
                continue;
            }

            if (val && typeof val === 'object') {
                const type = typeof val.type === 'number' ? val.type : 0;
                // discord only -> skip twitch shoutout
                if (type === 1) continue;
                // 0 or 2 -> allow twitch shoutout
                favourites.add(name.toLowerCase());
                continue;
            }
        }
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
        if (isBroadcaster(tags)) return; // never shoutout the host

        const userId = tags['user-id'];
        if (!userId || greeted.has(userId)) return;

        const login = (tags.username || '').toLowerCase();
        if (!loadFavourites().has(login)) return;

        greeted.add(userId);
        setGate('greetedShoutouts', [...greeted]);
        Logger.log(`[FavShoutout] First message from favourited user ${senderName}, shouting out`);
        await chatShoutout(client, config, login);
    } catch (err) {
        Logger.error(`[FavShoutout] Failed to shout out ${senderName}: ${err.message}`);
    }
}

onRestoreGate((gates) => {
    if (Array.isArray(gates.greetedShoutouts)) {
        greeted = new Set(gates.greetedShoutouts);
        Logger.log(`[FavShoutout] Restored ${greeted.size} already-greeted user(s)`);
    }
});

// clears per-stream greeted state; called on bot start/stop
function resetFavouriteShoutout() {
    greeted = new Set();
    favourites = null;
    lastLoaded = 0;
}

module.exports = {checkFavouriteShoutout, resetFavouriteShoutout};
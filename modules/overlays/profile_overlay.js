// modules/overlays/profile_overlay.js
// Drives the OBS "user profile" browser-source overlay. Broadcasts a viewer's
// name, pfp, Glossels balance, rank, watchtime and badge set over the shared
// overlay hub ("profile" channel) when a command like !watchtime or !system
// rank fires. Uses the hub's busy/ACK lock (same as the Top 10 overlay) so the
// animation is not replayed on top of itself.
const axios = require('axios');
const {config} = require('../../config');
const {Logger} = require('../../services');
const hub = require('./overlay_hub');
const {retrieveGlossels, getUserRank} = require('../functions/currency/glossels');
const {getWatchtime} = require('../functions/watchtime');
const {getFollowage} = require('../functions/followage');
const {resolveBadges} = require('../functions/badges');

const CHANNEL = 'profile';

// Wired by configureProfileOverlay() from bot.js (app token + client id).
let getAccessToken = async () => {
    throw new Error(
        '[ProfileOverlay] getAccessToken is not wired up, pass one via ' +
        'configureProfileOverlay({ getAccessToken, clientId })'
    );
};
let clientId = process.env.CLIENT_ID;

function configureProfileOverlay(options = {}) {
    if (options.getAccessToken) getAccessToken = options.getAccessToken;
    if (options.clientId) clientId = options.clientId;
}

// Fetch display name + pfp + chat color fresh from Helix on every trigger.
// Name + pfp come from /users, chat color from /chat/color (color is not
// part of the users payload). Nothing is cached.
async function fetchUserProfile(userId, userName) {
    try {
        const token = await getAccessToken();
        const headers = {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`,
        };

        const userRes = await axios.get('https://api.twitch.tv/helix/users', {
            params: {id: userId},
            headers,
        });
        const u = userRes.data.data?.[0];

        let color = null;
        try {
            const colorRes = await axios.get('https://api.twitch.tv/helix/chat/color', {
                params: {user_id: userId},
                headers,
            });
            color = colorRes.data.data?.[0]?.color || null; // empty string when no custom color
        } catch (e) {
            Logger.warn(`[ProfileOverlay] Failed to fetch chat color for ${userName}: ${e.message}`);
        }

        return {
            name: u?.display_name || userName || 'unknown',
            login: u?.login || userName || '',
            pfp: u?.profile_image_url || '',
            color,
        };
    } catch (err) {
        Logger.error(`[ProfileOverlay] Failed to fetch profile for ${userName}: ${err.message}`);
        return {name: userName || 'unknown', login: userName || '', pfp: '', color: null};
    }
}

// badges come straight from the triggering message's tmi tags.
async function buildProfile(userId, userName, tags) {
    const [profile, badges] = await Promise.all([
        fetchUserProfile(userId, userName),
        resolveBadges(tags?.badges || {}),
    ]);

    const amount = retrieveGlossels(userId, userName);
    const rank = getUserRank(userId);
    const watchSeconds = getWatchtime(userId);
    const followage = await getFollowage(userId, config); // formatted string or null

    return {
        name: profile.name,
        login: profile.login,
        pfp: profile.pfp || '',
        color: profile.color || null,
        balance: amount,
        rank: rank || null,
        watchtime: watchSeconds,
        followage,
        badges,
    };
}

// Entry point used by the chat commands.
async function triggerProfileOverlay({userId, userName, tags}) {
    if (!hub.isStarted()) {
        Logger.warn('[ProfileOverlay] triggerProfileOverlay() called before startOverlayHub()');
        return null;
    }
    if (hub.isBusy(CHANNEL)) {
        Logger.log(`[ProfileOverlay] busy (animation showing), dropping profile for ${userName}`);
        return null;
    }

    let profile;
    try {
        profile = await buildProfile(userId, userName, tags);
    } catch (err) {
        Logger.error(`[ProfileOverlay] Failed to build profile for ${userName}: ${err.message}`);
        return null;
    }

    if (hub.clientCount(CHANNEL) === 0) {
        Logger.log(`[ProfileOverlay] No browser source connected, skipping profile for ${userName}`);
        return profile;
    }

    const {sent, count} = hub.broadcast(CHANNEL, {type: 'show-profile', profile}, {awaitAck: true});

    if (sent) {
        Logger.log(`[ProfileOverlay] Triggered for ${userName} (${count} client(s))`);
    }

    return profile;
}

module.exports = {configureProfileOverlay, triggerProfileOverlay};

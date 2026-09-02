// modules/helpers/profile_overlay_server.js
// Drives the OBS "user profile" browser-source overlay. Runs a small WebSocket
// server that broadcasts a viewer's name, pfp, Glossels balance, rank,
// watchtime and badge set when a command like !watchtime or !sys rank fires.
// Uses the same busy/ACK pattern as the Top 10 overlay so the animation is not
// replayed on top of itself.
const WebSocket = require('ws');
const axios = require('axios');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {withTokenRetry, refreshAppToken} = require('../../auth');
const {retrieveGlossels, getUserRank} = require('../functions/currency/glossels');
const {getWatchtime} = require('../functions/watchtime');
const {getFollowage} = require('../functions/followage');
const {resolveBadges} = require('../functions/badges');
const PROFILE_WS_PORT = config.PROFILE_OVERLAY_PORT || 8430;

const awaitingAck = new Set();
let busy = false;
let wss = null;

// Wired by startProfileOverlayServer() from bot.js (app token + client id).
let getAccessToken = async () => {
    throw new Error(
        '[ProfileOverlay] getAccessToken is not wired up, pass one via ' +
        'startProfileOverlayServer({ getAccessToken, clientId })'
    );
};
let clientId = process.env.CLIENT_ID;

function startProfileOverlayServer(options = {}) {
    if (options.getAccessToken) getAccessToken = options.getAccessToken;
    if (options.clientId) clientId = options.clientId;

    if (wss) return;

    wss = new WebSocket.Server({port: PROFILE_WS_PORT});

    wss.on('connection', (socket) => {
        Logger.log(`[ProfileOverlay] Browser source connected (${wss.clients.size} total)`);
        socket.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'done') clearAck(socket);
            } catch {
                // ignore malformed frames
            }
        });
        socket.on('close', () => {
            Logger.log(`[ProfileOverlay] Browser source disconnected (${wss.clients.size} total)`);
            clearAck(socket);
        });
        socket.on('error', (err) => {
            Logger.error(`[ProfileOverlay] Client socket error: ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        Logger.error(`[ProfileOverlay] WebSocket server error: ${err.message}`);
    });

    Logger.log(`[ProfileOverlay] Listening on ws://localhost:${PROFILE_WS_PORT}`);
}

function clearAck(socket) {
    awaitingAck.delete(socket);
    if (awaitingAck.size === 0) busy = false;
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
    if (!wss) {
        Logger.warn('[ProfileOverlay] triggerProfileOverlay() called before startProfileOverlayServer()');
        return null;
    }
    if (busy) {
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

    if (wss.clients.size === 0) {
        Logger.log(`[ProfileOverlay] No browser source connected, skipping profile for ${userName}`);
        return profile;
    }

    const payload = JSON.stringify({type: 'show-profile', profile});
    let sent = false;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
            awaitingAck.add(client);
            sent = true;
        }
    });

    if (sent) {
        busy = true;
        Logger.log(`[ProfileOverlay] Triggered for ${userName} (${wss.clients.size} client(s))`);
    }

    return profile;
}

module.exports = {startProfileOverlayServer, triggerProfileOverlay};

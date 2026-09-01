// modules/helpers/top10_overlay_server.js
// Drives the OBS "Top 10" browser-source overlay. Runs a small WebSocket
// server the browser source connects to, broadcasts the top 10 Glossels
// leaderboard when triggered, and attaches each user's Twitch chat color
// via the Helix "Get User Chat Color" endpoint (one batched call).
const WebSocket = require('ws');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {getLeaderboard} = require('../functions/currency/glossels');

const OVERLAY_WS_PORT = config.TOP10_OVERLAY_PORT;

// Twitch's known default nameplate colors, used as a deterministic
// fallback for users who never set a custom chat color (Helix returns
// an empty string for these). This is an approximation of Twitch's own
// hashing, so it won't necessarily match what viewers see in chat, but
// it's a reasonable stand-in so rows aren't colorless.
const DEFAULT_COLOR_PALETTE = [
    '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
    '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
    '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F',
];

function fallbackColor(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    return DEFAULT_COLOR_PALETTE[hash % DEFAULT_COLOR_PALETTE.length];
}

const COLOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h, chat colors rarely change
const colorCache = new Map(); // userId -> { color, expires }

// Trailing debounce so a burst of !system top collapses into one broadcast
// instead of spamming the overlay (which would replay its animation each time).
const DEBOUNCE_MS = 800; // post-burst delay before the broadcast fires
let debounceTimer = null;

// "Busy" lock: once a sequence is broadcast to the overlay, further triggers
// are ignored until the browser source ACKs back that it finished playing.
// The html sends {"type":"done"} at the very end of its animation. Tracks per
// client so the lock clears reliably even when clients drop mid-sequence.
const awaitingAck = new Set(); // sockets currently being shown, not yet ACKed
let busy = false;

let wss = null;

// Wired by startTop10OverlayServer() from bot.js (app token + client id).
// Needs to resolve to a Twitch app/bot access token for the Helix color call.
let getAccessToken = async () => {
    throw new Error(
        '[Top10Overlay] getAccessToken is not wired up, pass one via ' +
        'startTop10OverlayServer({ getAccessToken, clientId })'
    );
};
let clientId = process.env.CLIENT_ID;

function startTop10OverlayServer(options = {}) {
    if (options.getAccessToken) getAccessToken = options.getAccessToken;
    if (options.clientId) clientId = options.clientId;

    if (wss) return; // already started

    wss = new WebSocket.Server({port: OVERLAY_WS_PORT});

    wss.on('connection', (socket) => {
        Logger.log(`[Top10Overlay] Browser source connected (${wss.clients.size} total)`);
        socket.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'done') clearAck(socket);
            } catch {
                // ignore malformed frames from the browser source
            }
        });
        socket.on('close', () => {
            Logger.log(`[Top10Overlay] Browser source disconnected (${wss.clients.size} total)`);
            clearAck(socket); // gone, so it can't be holding the lock
        });
        socket.on('error', (err) => {
            Logger.error(`[Top10Overlay] Client socket error: ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        Logger.error(`[Top10Overlay] WebSocket server error: ${err.message}`);
    });

    Logger.log(`[Top10Overlay] Listening on ws://localhost:${OVERLAY_WS_PORT}`);
}

function getTop10() {
    // Same fresh, always-sorted in-memory leaderboard !system top uses.
    const userData = getLeaderboard();
    if (!userData || userData.length === 0) return [];

    return userData
        .filter((u) => u && typeof u.amount === 'number')
        .slice(0, 10)
        .map((u, i) => ({rank: i + 1, name: u.usrName, amount: u.amount, userId: String(u.usrId)}));
}

async function attachChatColors(leaderboard) {
    const now = Date.now();
    const idsNeedingFetch = leaderboard
        .map((e) => e.userId)
        .filter((id) => {
            const cached = colorCache.get(id);
            return !cached || cached.expires < now;
        });

    if (idsNeedingFetch.length > 0) {
        try {
            const token = await getAccessToken();
            const query = idsNeedingFetch.map((id) => `user_id=${encodeURIComponent(id)}`).join('&');
            const res = await fetch(`https://api.twitch.tv/helix/chat/color?${query}`, {
                headers: {
                    'Client-Id': clientId,
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!res.ok) {
                throw new Error(`Helix chat/color returned ${res.status}`);
            }
            const json = await res.json();
            (json.data || []).forEach((entry) => {
                colorCache.set(entry.user_id, {
                    color: entry.color || null, // empty string -> no custom color set
                    expires: now + COLOR_CACHE_TTL_MS,
                });
            });
        } catch (err) {
            Logger.error(`[Top10Overlay] Failed to fetch chat colors: ${err.message}`);
            // fall through, rows without a cached color get the deterministic fallback below
        }
    }

    return leaderboard.map((entry) => {
        const cached = colorCache.get(entry.userId);
        const color = (cached && cached.color) || fallbackColor(entry.userId);
        return {...entry, color};
    });
}

function clearAck(socket) {
    awaitingAck.delete(socket);
    if (awaitingAck.size === 0) busy = false;
}

function triggerTop10Overlay() {
    if (!wss) {
        Logger.warn('[Top10Overlay] triggerTop10Overlay() called before startTop10OverlayServer()');
        return;
    }
    if (busy) return; // a sequence is still showing, drop the re-trigger
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void broadcastTop10();
    }, DEBOUNCE_MS);
}

async function broadcastTop10() {
    let leaderboard = getTop10();
    if (leaderboard.length === 0) {
        Logger.warn('[Top10Overlay] No leaderboard data to show, skipping trigger');
        return;
    }

    leaderboard = await attachChatColors(leaderboard);

    const payload = JSON.stringify({type: 'show-top10', leaderboard});
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
        Logger.log(`[Top10Overlay] Triggered (${wss.clients.size} client(s)), awaiting ACK`);
    }
}

module.exports = {startTop10OverlayServer, triggerTop10Overlay};
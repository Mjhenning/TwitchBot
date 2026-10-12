// modules/overlays/top10_overlay.js
// Drives the OBS "Top 10" browser-source overlay. Broadcasts the top 10
// Glossels leaderboard over the shared overlay hub ("top10" channel) when
// triggered, and attaches each user's Twitch chat color via the Helix
// "Get User Chat Color" endpoint (one batched call).
const {Logger} = require('../../services');
const hub = require('./overlay_hub');
const {getLeaderboard} = require('../functions/currency/glossels');

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

const CHANNEL = 'top10';

// Wired by configureTop10Overlay() from bot.js (app token + client id). Needs
// to resolve to a Twitch app/bot access token for the Helix color call.
let getAccessToken = async () => {
    throw new Error(
        '[Top10Overlay] getAccessToken is not wired up, pass one via ' +
        'configureTop10Overlay({ getAccessToken, clientId })'
    );
};
let clientId = process.env.CLIENT_ID;

function configureTop10Overlay(options = {}) {
    if (options.getAccessToken) getAccessToken = options.getAccessToken;
    if (options.clientId) clientId = options.clientId;
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

function triggerTop10Overlay() {
    if (!hub.isStarted()) {
        Logger.warn('[Top10Overlay] triggerTop10Overlay() called before startOverlayHub()');
        return;
    }
    if (hub.isBusy(CHANNEL)) return; // a sequence is still showing, drop the re-trigger
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

    const {sent, count} = hub.broadcast(CHANNEL, {type: 'show-top10', leaderboard}, {awaitAck: true});

    if (sent) {
        Logger.log(`[Top10Overlay] Triggered (${count} client(s)), awaiting ACK`);
    }
}

module.exports = {configureTop10Overlay, triggerTop10Overlay};
// modules/functions/badges.js
// Resolves a viewer's badge set (from tmi tags, e.g. {subscriber: "12",
// vip: "1"}) into a list of badge image URLs for the profile overlay. Fetches
// the channel's and Twitch's global badge definitions once and caches them.
const axios = require('axios');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {withTokenRetry, refreshAppToken} = require('../../auth');

// ---------------- CACHE ----------------
const BADGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let badgeCatalog = null; // { set -> { version -> { title, image } } }
let badgeCatalogExpires = 0;

// Display priority: higher value renders first in the badge grid.
const BADGE_PRIORITY = {
    broadcaster: 8,
    moderator: 7,
    staff: 6,
    admin: 6,
    vip: 5,
    subscriber: 4,
    founder: 4,
    bits: 3,
    subgift: 3,
    predictions: 2,
    'hype-train': 2
};

// tmi reports some badge set ids with underscores while Twitch's badge
// endpoints use hyphens; map the tmi spelling to the API set_id.
const SET_ID_ALIASES = {
    hype_train: 'hype-train',
    sub_gift: 'sub-gift',
    bits_leader: 'bits-leader',
    sub_gifter: 'sub-gifter'
};

async function fetchBadgeCatalog() {
    const now = Date.now();
    if (badgeCatalog && badgeCatalogExpires > now) return badgeCatalog;

    const catalog = {};
    const headers = {
        'Client-ID': config.CLIENT_ID,
        'Authorization': `Bearer ${config.APP_TOKEN}`
    };

    // Fetch global and channel badge sets independently so a failure on one
    // doesn't wipe out the other (the helper logs the failure either way).
    // Global and channel are separate Twitch endpoints: the global one has no
    // params and the channel one requires broadcaster_id.
    const segments = [
        {url: 'https://api.twitch.tv/helix/chat/badges/global', params: null, label: 'global'},
        {url: 'https://api.twitch.tv/helix/chat/badges', params: {broadcaster_id: config.BROADCASTER_ID}, label: 'channel'}
    ];

    for (const seg of segments) {
        try {
            const body = await withTokenRetry(async () => {
                const res = await axios.get(seg.url, {
                    params: seg.params,
                    headers,
                });
                return res.data;
            }, refreshAppToken);

            for (const set of body.data || []) {
                catalog[set.set_id] = {};
                for (const v of set.versions || []) {
                    catalog[set.set_id][v.id] = {
                        title: v.title || set.set_id,
                        image: v.image_url_4x || v.image_url_2x || v.image_url_1x
                    };
                }
            }

            Logger.log(`[Badges] Loaded ${(body.data || []).length} badge sets from ${seg.label} endpoint`);
        } catch (err) {
            Logger.error(`[Badges] Failed to fetch ${seg.label} badge catalog: ${err.message}`);
        }
    }

    badgeCatalog = catalog;
    badgeCatalogExpires = now + BADGE_CACHE_TTL_MS;
    return badgeCatalog;
}

// badges: the raw tmi tags.badges object, e.g. {subscriber: "12", vip: "1"}.
// Returns a sorted array of { id, name, version, title, image, priority }.
async function resolveBadges(badges = {}) {
    const catalog = await fetchBadgeCatalog();
    const result = [];

    for (const [rawId, version] of Object.entries(badges)) {
        const id = SET_ID_ALIASES[rawId] || rawId;
        const def = catalog[id]?.[version] || catalog[id]?.['0'];
        if (!def || !def.image) continue;

        result.push({
            id: rawId,
            version,
            name: def.title,
            image: def.image,
            priority: BADGE_PRIORITY[id] !== undefined ? BADGE_PRIORITY[id] : 1
        });
    }

    return result.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

module.exports = {resolveBadges};

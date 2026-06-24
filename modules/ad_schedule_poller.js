// modules/ad_schedule_poller.js
const axios = require('axios');
const {withTokenRetry} = require('../config');
const {
    getIsOnline,
    onOnline,
    onOffline
} = require('./stream-state');

// ── State ─────────────────────────────────────────────────────────────────────

let adaptiveInterval = null;
let currentPollMs = 15_000; // starts slow, tightens once a real ad is detected
let warnedAdAt = null;   // tracks which ad timestamp we've already warned for

const WARN_SECONDS_BEFORE = 45;

// Twitch returns a zero-value placeholder date (e.g. "0001-01-01T00:00:00Z")
// when no ad is currently scheduled, rather than omitting the field. Anything
// before this sanity boundary (~2001) is treated as "no ad scheduled."
const MIN_VALID_TIMESTAMP_MS = 1_000_000_000_000;

// ── API Call ──────────────────────────────────────────────────────────────────

async function getAdSchedule(config) {
    const res = await axios.get(
        'https://api.twitch.tv/helix/channels/ads',
        {
            params: {broadcaster_id: config.CHANNEL_ID},
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
            }
        }
    );

    return res.data?.data?.[0] ?? null;
}

// ── Poll Logic ────────────────────────────────────────────────────────────────

async function doPoll(client, config) {
    try {
        const adData = await withTokenRetry(() => getAdSchedule(config));

        const nextAdTime = adData?.next_ad_at
            ? new Date(adData.next_ad_at).getTime()
            : 0;

        // ── No real ad scheduled yet ───────────────────────────────────────
        // Twitch doesn't appear to populate next_ad_at until shortly before
        // the ad actually fires, so most polls will land here.
        if (!nextAdTime || nextAdTime < MIN_VALID_TIMESTAMP_MS) {
            currentPollMs = 15_000;
            console.log('[AdPoller] No scheduled ad');
            return;
        }

        const secondsUntil = Math.floor((nextAdTime - Date.now()) / 1000);

        // ── Adaptive poll rate ─────────────────────────────────────────────
        // Once a real ad timestamp shows up, poll quickly so we don't miss
        // the warn window — Twitch tends to only give a short heads-up anyway.
        if (secondsUntil <= 0) {
            currentPollMs = 15_000; // ad passed, back to slow
        } else {
            currentPollMs = 2_000; // any valid upcoming ad — poll fast
        }

        console.log(`[AdPoller] Next ad in ${secondsUntil}s (polling every ${currentPollMs / 1000}s)`);

        // ── Warning ────────────────────────────────────────────────────────
        if (
            secondsUntil > 0 &&
            secondsUntil <= WARN_SECONDS_BEFORE &&
            warnedAdAt !== adData.next_ad_at
        ) {
            warnedAdAt = adData.next_ad_at;

            await client.say(
                `#${config.CHANNEL_NAME}`,
                `⚠️ Bitrot interference nearing the Glosso-Sphere in ~${secondsUntil}s! Finish your messages and stay connected 📡`
            );

            console.log('[AdPoller] Warning sent');
        }

        // ── Reset after ad passes ──────────────────────────────────────────
        if (secondsUntil <= 0 && warnedAdAt === adData.next_ad_at) {
            warnedAdAt = null;
        }

    } catch (err) {
        console.error('[AdPoller] Failed:', err.response?.data || err.message || err);
    }
}

// ── Adaptive Scheduler ────────────────────────────────────────────────────────

function scheduleNextPoll(client, config) {
    adaptiveInterval = setTimeout(async () => {
        if (!getIsOnline()) return;

        await doPoll(client, config);
        scheduleNextPoll(client, config);
    }, currentPollMs);
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

function beginPolling(client, config) {
    if (adaptiveInterval) return;

    console.log('[AdPoller] Waiting 60s before activation...');

    setTimeout(() => {
        if (!getIsOnline()) {
            console.log('[AdPoller] Stream went offline before startup — aborting');
            return;
        }

        console.log('[AdPoller] Started');
        scheduleNextPoll(client, config);
    }, 60_000);
}

function stopPolling() {
    if (adaptiveInterval) {
        clearTimeout(adaptiveInterval);
        adaptiveInterval = null;
    }

    warnedAdAt = null;
    currentPollMs = 15_000;

    console.log('[AdPoller] Stopped');
}

// ── Entry Point ───────────────────────────────────────────────────────────────

function startAdSchedulePoller(client, config) {
    onOnline(() => beginPolling(client, config));
    onOffline(stopPolling);

    if (getIsOnline()) {
        beginPolling(client, config);
    } else {
        console.log('[AdPoller] Waiting for stream to go online...');
    }
}

module.exports = {
    startAdSchedulePoller,
    stopAdSchedulePoller: stopPolling
};
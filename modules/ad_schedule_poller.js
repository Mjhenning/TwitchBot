// modules/ad_schedule_poller.js
const axios = require('axios');
const {
    getIsOnline,
    onOnline,
    onOffline
} = require('./stream-state');

// ── State ─────────────────────────────────────────────────────────────────────

let adaptiveInterval = null; // replaces fixed pollInterval
let currentPollMs = 15_000; // starts slow, tightens as ad approaches
let warnedAdAt = null;   // tracks which ad timestamp we've already warned for

const WARN_SECONDS_BEFORE = 90;

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

async function doPoll(client, config, withTokenRetry) {
    try {
        // withTokenRetry refreshes the broadcaster token and retries on 401
        const adData = await withTokenRetry(() => getAdSchedule(config));

        if (!adData?.next_ad_at) {
            currentPollMs = 15_000;
            console.log('[AdPoller] No scheduled ad');
            return;
        }

        const secondsUntil = Math.floor(
            (new Date(adData.next_ad_at).getTime() - Date.now()) / 1000
        );

        // ── Adaptive poll rate ─────────────────────────────────────────────
        // Tighten polling as the ad approaches so we don't miss the warn window
        // even if Twitch only gives us a short heads-up
        if (secondsUntil <= 0) {
            currentPollMs = 15_000; // ad passed, back to slow
        } else if (secondsUntil <= 120) {
            currentPollMs = 2_000;  // within 2 min — poll every 2s
        } else if (secondsUntil <= 300) {
            currentPollMs = 5_000;  // within 5 min — poll every 5s
        } else {
            currentPollMs = 15_000; // far away — poll every 15s
        }

        console.log(`[AdPoller] Next ad in ${secondsUntil}s (polling every ${currentPollMs / 1000}s)`);

        // ── Warning ────────────────────────────────────────────────────────
        // Send once per ad — warnedAdAt prevents duplicate messages
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
        // Clears warnedAdAt so the next scheduled ad can trigger a fresh warning
        if (secondsUntil <= 0 && warnedAdAt === adData.next_ad_at) {
            warnedAdAt = null;
        }

    } catch (err) {
        console.error('[AdPoller] Failed:', err.response?.data || err.message || err);
    }
}

// ── Adaptive Scheduler ────────────────────────────────────────────────────────
// Uses setTimeout instead of setInterval so the poll rate can change
// dynamically between each tick based on how close the next ad is

function scheduleNextPoll(client, config, withTokenRetry) {
    adaptiveInterval = setTimeout(async () => {
        if (!getIsOnline()) return; // stop silently if stream ended mid-poll

        await doPoll(client, config, withTokenRetry);
        scheduleNextPoll(client, config, withTokenRetry); // reschedule with updated currentPollMs
    }, currentPollMs);
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

function beginPolling(client, config, withTokenRetry) {
    if (adaptiveInterval) return; // prevent duplicate loops

    console.log('[AdPoller] Waiting 60s before activation...');

    setTimeout(() => {
        if (!getIsOnline()) {
            console.log('[AdPoller] Stream went offline before startup — aborting');
            return;
        }

        console.log('[AdPoller] Started');
        scheduleNextPoll(client, config, withTokenRetry);
    }, 60_000);
}

function stopPolling() {
    if (adaptiveInterval) {
        clearTimeout(adaptiveInterval);
        adaptiveInterval = null;
    }

    warnedAdAt = null;
    currentPollMs = 15_000; // reset rate for next stream

    console.log('[AdPoller] Stopped');
}

// ── Entry Point ───────────────────────────────────────────────────────────────

function startAdSchedulePoller(client, config, withTokenRetry) {
    // Pass withTokenRetry through to beginPolling so every API call is protected
    onOnline(() => beginPolling(client, config, withTokenRetry));
    onOffline(stopPolling);

    if (getIsOnline()) {
        beginPolling(client, config, withTokenRetry);
    } else {
        console.log('[AdPoller] Waiting for stream to go online...');
    }
}

module.exports = {
    startAdSchedulePoller,
    stopAdSchedulePoller: stopPolling
};
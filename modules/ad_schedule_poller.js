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
let pollCount = 0;       // for log correlation across the lifetime of a session

const WARN_SECONDS_BEFORE = 45;

// Twitch returns a zero-value placeholder date (e.g. "0001-01-01T00:00:00Z")
// when no ad is currently scheduled, rather than omitting the field. Anything
// before this sanity boundary (~2001) is treated as "no ad scheduled."
const MIN_VALID_TIMESTAMP_MS = 1_000_000_000_000;

// ── API Call ──────────────────────────────────────────────────────────────────

async function getAdSchedule(config) {
    console.log('[AdPoller] → GET /helix/channels/ads');

    const res = await axios.get(
        'https://api.twitch.tv/helix/channels/ads',
        {
            params: {broadcaster_id: config.BROADCASTER_ID},
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
            }
        }
    );

    console.log('[AdPoller] ← raw response:', JSON.stringify(res.data?.data?.[0] ?? null));

    return res.data?.data?.[0] ?? null;
}

// ── Poll Logic ────────────────────────────────────────────────────────────────

async function doPoll(client, config) {
    pollCount++;
    console.log(`[AdPoller] ── Poll #${pollCount} starting (prev interval was ${currentPollMs / 1000}s) ──`);

    try {
        const adData = await withTokenRetry(() => getAdSchedule(config));

        const nextAdTime = adData?.next_ad_at
            ? new Date(adData.next_ad_at).getTime()
            : 0;

        console.log(
            `[AdPoller] Parsed next_ad_at="${adData?.next_ad_at ?? 'null'}" → ` +
            `nextAdTime=${nextAdTime} (MIN_VALID=${MIN_VALID_TIMESTAMP_MS})`
        );

        // ── No real ad scheduled yet ───────────────────────────────────────
        // Twitch doesn't appear to populate next_ad_at until shortly before
        // the ad actually fires, so most polls will land here.
        if (!nextAdTime || nextAdTime < MIN_VALID_TIMESTAMP_MS) {
            console.log('[AdPoller] No scheduled ad (placeholder or missing timestamp) — staying on slow tier');
            currentPollMs = 15_000;
            console.log(`[AdPoller] ── Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s ──`);
            return;
        }

        const secondsUntil = Math.floor((nextAdTime - Date.now()) / 1000);
        console.log(`[AdPoller] Now=${Date.now()}, secondsUntil=${secondsUntil}`);

        // ── Adaptive poll rate ─────────────────────────────────────────────
        // Once a real ad timestamp shows up, poll quickly so we don't miss
        // the warn window — Twitch tends to only give a short heads-up anyway.
        const previousTier = currentPollMs;
        if (secondsUntil <= 0) {
            currentPollMs = 15_000; // ad passed, back to slow
        } else {
            currentPollMs = 2_000; // any valid upcoming ad — poll fast
        }
        if (previousTier !== currentPollMs) {
            console.log(`[AdPoller] Poll tier changed: ${previousTier / 1000}s → ${currentPollMs / 1000}s`);
        }

        console.log(`[AdPoller] Next ad in ${secondsUntil}s (polling every ${currentPollMs / 1000}s)`);

        // ── Warning ────────────────────────────────────────────────────────
        const inWarnWindow = secondsUntil > 0 && secondsUntil <= WARN_SECONDS_BEFORE;
        const alreadyWarnedThisAd = warnedAdAt === adData.next_ad_at;

        console.log(
            `[AdPoller] Warning check: inWarnWindow=${inWarnWindow} ` +
            `(threshold=${WARN_SECONDS_BEFORE}s), alreadyWarnedThisAd=${alreadyWarnedThisAd}, ` +
            `warnedAdAt=${warnedAdAt ?? 'null'}`
        );

        if (inWarnWindow && !alreadyWarnedThisAd) {
            warnedAdAt = adData.next_ad_at;
            console.log(`[AdPoller] >>> FIRING warning for next_ad_at="${adData.next_ad_at}" (${secondsUntil}s out)`);

            await client.say(
                `#${config.CHANNEL_NAME}`,
                `⚠️ Bitrot interference nearing the Glosso-Sphere in ~${secondsUntil}s! Finish your messages and stay connected 📡`
            );

            console.log('[AdPoller] Warning sent');
        }

        // ── Reset after ad passes ──────────────────────────────────────────
        if (secondsUntil <= 0 && warnedAdAt === adData.next_ad_at) {
            console.log(`[AdPoller] Ad timestamp "${adData.next_ad_at}" has passed — resetting warnedAdAt`);
            warnedAdAt = null;
        }

        console.log(`[AdPoller] ── Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s ──`);

    } catch (err) {
        console.error('[AdPoller] Failed:', err.response?.data || err.message || err);
        console.log(`[AdPoller] ── Poll #${pollCount} done (errored). Next poll in ${currentPollMs / 1000}s ──`);
    }
}

// ── Adaptive Scheduler ────────────────────────────────────────────────────────

function scheduleNextPoll(client, config) {
    console.log(`[AdPoller] Scheduling next poll in ${currentPollMs / 1000}s`);

    adaptiveInterval = setTimeout(async () => {
        if (!getIsOnline()) {
            console.log('[AdPoller] Stream is offline at scheduled poll time — skipping this cycle and NOT rescheduling. Poller is now idle until next onOnline().');
            return;
        }

        await doPoll(client, config);
        scheduleNextPoll(client, config);
    }, currentPollMs);
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

function beginPolling(client, config) {
    if (adaptiveInterval) {
        console.log('[AdPoller] beginPolling called but adaptiveInterval already set — ignoring');
        return;
    }

    console.log('[AdPoller] Waiting 60s before activation...');

    setTimeout(() => {
        if (!getIsOnline()) {
            console.log('[AdPoller] Stream went offline before startup — aborting');
            return;
        }

        pollCount = 0;
        currentPollMs = 15_000;
        console.log('[AdPoller] Started');
        scheduleNextPoll(client, config);
    }, 60_000);
}

function stopPolling() {
    if (adaptiveInterval) {
        clearTimeout(adaptiveInterval);
        adaptiveInterval = null;
    }

    console.log(`[AdPoller] Stopping. Final state: pollCount=${pollCount}, warnedAdAt=${warnedAdAt ?? 'null'}`);

    warnedAdAt = null;
    currentPollMs = 15_000;

    console.log('[AdPoller] Stopped');
}

// ── Entry Point ───────────────────────────────────────────────────────────────

function startAdSchedulePoller(client, config) {
    onOnline(() => {
        console.log('[AdPoller] onOnline fired — calling beginPolling');
        beginPolling(client, config);
    });
    onOffline(() => {
        console.log('[AdPoller] onOffline fired — calling stopPolling');
        stopPolling();
    });

    if (getIsOnline()) {
        console.log('[AdPoller] Already online at startAdSchedulePoller — beginning immediately');
        beginPolling(client, config);
    } else {
        console.log('[AdPoller] Waiting for stream to go online...');
    }
}

module.exports = {
    startAdSchedulePoller,
    stopAdSchedulePoller: stopPolling
};
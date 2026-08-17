// modules/ad_schedule_poller.js
const axios = require('axios');
const {withTokenRetry} = require('../../auth');
const {
    getIsOnline,
    onOnline,
    onOffline
} = require('./stream-state');

// ── State ─────────────────────────────────────────────────────────────────────

let adaptiveInterval = null;
let startupTimeout = null;   // held so we can cancel it if stopPolling fires during the 60s window
let currentPollMs = 15_000;  // starts slow, tightens once a real ad is detected
let warnedAdAt = null;       // Unix-second timestamp we've already warned for (number)
let pollCount = 0;           // for log correlation across the lifetime of a session
let lastLoggedSecondsUntil = null; // throttle the "next ad in Xs" log
let previousSecondsUntil = null;

const WARN_SECONDS_BEFORE = 45;

// Twitch returns next_ad_at as a Unix timestamp in *seconds* (not milliseconds),
// and returns 0 when no ad is scheduled. Multiply by 1000 before comparing to
// Date.now(). Anything before ~2001 in ms is treated as "no ad scheduled."
const MIN_VALID_TIMESTAMP_MS = 1_000_000_000_000;

// Only re-log "next ad in Xs" when the value changes by at least this many seconds,
// to avoid spamming the console every 2s while an ad is still far away.
const LOG_SECONDS_CHANGE_THRESHOLD = 30;

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

        // next_ad_at is Unix seconds — multiply by 1000 to get milliseconds
        const nextAdTime = adData?.next_ad_at ? Date.parse(adData.next_ad_at) : 0;

        // preroll_free_time > 0 means the broadcaster has earned ad-free time and
        // the scheduled ad cannot fire yet, regardless of what next_ad_at says.
        const prerollFreeSeconds = adData?.preroll_free_time ?? 0;

        console.log({
            now: new Date().toISOString(),
            next_ad_at: adData?.next_ad_at ?? null,
            parsed: nextAdTime ? new Date(nextAdTime).toISOString() : null,
            prerollFreeSeconds
        });

        // ── No real ad scheduled yet ───────────────────────────────────────
        if (!nextAdTime || nextAdTime < MIN_VALID_TIMESTAMP_MS) {
            console.log('[AdPoller] No scheduled ad (placeholder or missing timestamp) — staying on slow tier');
            currentPollMs = 15_000;
            lastLoggedSecondsUntil = null;
            console.log(`[AdPoller] ── Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s ──`);
            return;
        }

        // ── Preroll-free gate ──────────────────────────────────────────────
        // Ad is scheduled but can't fire yet — don't warn, but do poll fast
        // so we catch the transition when preroll_free_time reaches 0.
        if (prerollFreeSeconds > 0) {
            console.log(`[AdPoller] Ad scheduled but blocked by preroll_free_time=${prerollFreeSeconds}s — holding fast poll, no warning`);
            currentPollMs = 2_000;
            console.log(`[AdPoller] ── Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s ──`);
            return;
        }

        const secondsUntil = Math.ceil((nextAdTime - Date.now()) / 1000);

        // ── Adaptive poll rate ─────────────────────────────────────────────
        const previousTier = currentPollMs;
        if (secondsUntil <= 0) {
            currentPollMs = 15_000; // ad passed, back to slow
        } else {
            currentPollMs = 2_000;  // valid upcoming ad — poll fast
        }
        if (previousTier !== currentPollMs) {
            console.log(`[AdPoller] Poll tier changed: ${previousTier / 1000}s → ${currentPollMs / 1000}s`);
        }

        // ── Throttled countdown log ────────────────────────────────────────
        const secondsChanged = lastLoggedSecondsUntil === null ||
            Math.abs(lastLoggedSecondsUntil - secondsUntil) >= LOG_SECONDS_CHANGE_THRESHOLD;

        if (secondsChanged) {
            console.log(`[AdPoller] Next ad in ${secondsUntil}s (polling every ${currentPollMs / 1000}s)`);
            lastLoggedSecondsUntil = secondsUntil;
        }

        // ── Warning ────────────────────────────────────────────────────────
        const alreadyWarnedThisAd = warnedAdAt === nextAdTime;

        const crossedThreshold =
            previousSecondsUntil === null ||
            (
                previousSecondsUntil > WARN_SECONDS_BEFORE &&
                secondsUntil <= WARN_SECONDS_BEFORE
            );

        previousSecondsUntil = secondsUntil;

        console.log(
            `[AdPoller] Warning check: inWarnWindow=${inWarnWindow} ` +
            `(threshold=${WARN_SECONDS_BEFORE}s), alreadyWarnedThisAd=${alreadyWarnedThisAd}, ` +
            `warnedAdAt=${warnedAdAt ?? 'null'}`
        );

        if (
            crossedThreshold &&
            !alreadyWarnedThisAd &&
            secondsUntil > 0
        ) {
            warnedAdAt = nextAdTime;
            console.log(`[AdPoller] >>> FIRING warning (${secondsUntil}s out)`);

            await client.say(
                `#${config.CHANNEL_NAME}`,
                `⚠️ Bitrot interference nearing the Glosso-Sphere in ~${secondsUntil}s! Finish your messages and stay connected 📡`
            );

            console.log('[AdPoller] Warning sent');
        }

        // ── Reset after ad passes ──────────────────────────────────────────
        if (secondsUntil <= 0 && warnedAdAt !== null) {
            console.log(`[AdPoller] Ad has passed — resetting warnedAdAt`);
            warnedAdAt = null;
            previousSecondsUntil = null;
            lastLoggedSecondsUntil = null;
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
            console.log('[AdPoller] Stream is offline at scheduled poll time — skipping and NOT rescheduling. Poller idle until next onOnline().');
            return;
        }

        await doPoll(client, config);
        scheduleNextPoll(client, config);
    }, currentPollMs);
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

function beginPolling(client, config) {
    if (adaptiveInterval || startupTimeout) {
        console.log('[AdPoller] beginPolling called but already running or in startup window — ignoring');
        return;
    }

    console.log('[AdPoller] Waiting 60s before activation...');

    startupTimeout = setTimeout(() => {
        startupTimeout = null;

        if (!getIsOnline()) {
            console.log('[AdPoller] Stream went offline before startup — aborting');
            return;
        }

        pollCount = 0;
        currentPollMs = 15_000;
        lastLoggedSecondsUntil = null;
        console.log('[AdPoller] Started');
        scheduleNextPoll(client, config);
    }, 60_000);
}

function stopPolling() {
    if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
        console.log('[AdPoller] Cancelled startup window');
    }

    if (adaptiveInterval) {
        clearTimeout(adaptiveInterval);
        adaptiveInterval = null;
    }

    console.log(`[AdPoller] Stopping. Final state: pollCount=${pollCount}, warnedAdAt=${warnedAdAt ?? 'null'}`);

    warnedAdAt = null;
    currentPollMs = 15_000;
    lastLoggedSecondsUntil = null;
    previousSecondsUntil = null;

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
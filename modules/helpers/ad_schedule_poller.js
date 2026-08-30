// modules/ad_schedule_poller.js
const axios = require('axios');
const {withTokenRetry} = require('../../auth');
const {Logger} = require('../../services');
const {
    getIsOnline,
    onOnline,
    onOffline
} = require('./stream-state');

//---------------------STATE---------------------

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

//---------------------API CALL---------------------

async function getAdSchedule(config) {
    Logger.log('[AdPoller] -> GET /helix/channels/ads');

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

    Logger.log(`[AdPoller] <- raw response: ${JSON.stringify(res.data?.data?.[0] ?? null)}`);

    return res.data?.data?.[0] ?? null;
}

//---------------------POLL LOGIC---------------------

async function doPoll(client, config) {
    pollCount++;
    Logger.log(`[AdPoller] -- Poll #${pollCount} starting (prev interval was ${currentPollMs / 1000}s) --`);

    try {
        const adData = await withTokenRetry(() => getAdSchedule(config));

        // next_ad_at is Unix seconds, multiply by 1000 to get milliseconds
        const nextAdTime = adData?.next_ad_at ? Date.parse(adData.next_ad_at) : 0;

        // preroll_free_time > 0 means the broadcaster has earned ad-free time and
        // the scheduled ad cannot fire yet, regardless of what next_ad_at says.
        const prerollFreeSeconds = adData?.preroll_free_time ?? 0;

        Logger.log(JSON.stringify({
            now: new Date().toISOString(),
            next_ad_at: adData?.next_ad_at ?? null,
            parsed: nextAdTime ? new Date(nextAdTime).toISOString() : null,
            prerollFreeSeconds
        }));

        //---------------------NO REAL AD SCHEDULED YET---------------------
        if (!nextAdTime || nextAdTime < MIN_VALID_TIMESTAMP_MS) {
            Logger.log('[AdPoller] No scheduled ad (placeholder or missing timestamp), staying on slow tier');
            currentPollMs = 15_000;
            lastLoggedSecondsUntil = null;
            Logger.log(`[AdPoller] -- Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s --`);
            return;
        }

        //---------------------PREROLL-FREE GATE---------------------
        // Ad is scheduled but can't fire yet, don't warn, but do poll fast
        // so we catch the transition when preroll_free_time reaches 0.
        if (prerollFreeSeconds > 0) {
            Logger.log(`[AdPoller] Ad scheduled but blocked by preroll_free_time=${prerollFreeSeconds}s, holding fast poll, no warning`);
            currentPollMs = 2_000;
            Logger.log(`[AdPoller] -- Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s --`);
            return;
        }

        const secondsUntil = Math.ceil((nextAdTime - Date.now()) / 1000);

        //---------------------ADAPTIVE POLL RATE---------------------
        const previousTier = currentPollMs;
        if (secondsUntil <= 0) {
            currentPollMs = 15_000; // ad passed, back to slow
        } else {
            currentPollMs = 2_000;  // valid upcoming ad, poll fast
        }
        if (previousTier !== currentPollMs) {
            Logger.log(`[AdPoller] Poll tier changed: ${previousTier / 1000}s -> ${currentPollMs / 1000}s`);
        }

        //---------------------THROTTLED COUNTDOWN LOG---------------------
        const secondsChanged = lastLoggedSecondsUntil === null ||
            Math.abs(lastLoggedSecondsUntil - secondsUntil) >= LOG_SECONDS_CHANGE_THRESHOLD;

        if (secondsChanged) {
            Logger.log(`[AdPoller] Next ad in ${secondsUntil}s (polling every ${currentPollMs / 1000}s)`);
            lastLoggedSecondsUntil = secondsUntil;
        }

        //---------------------WARNING---------------------
        const alreadyWarnedThisAd = warnedAdAt === nextAdTime;

        const crossedThreshold =
            previousSecondsUntil === null ||
            (
                previousSecondsUntil > WARN_SECONDS_BEFORE &&
                secondsUntil <= WARN_SECONDS_BEFORE
            );

        previousSecondsUntil = secondsUntil;

        Logger.log(
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
            Logger.log(`[AdPoller] >>> FIRING warning (${secondsUntil}s out)`);

            await client.say(
                `#${config.CHANNEL_NAME}`,
                `⚠️ Bitrot interference nearing the Glosso-Sphere in ~${secondsUntil}s! Finish your messages and stay connected 📡`
            );

            Logger.log('[AdPoller] Warning sent');
        }

        //---------------------RESET AFTER AD PASSES---------------------
        if (secondsUntil <= 0 && warnedAdAt !== null) {
            Logger.log(`[AdPoller] Ad has passed, resetting warnedAdAt`);
            warnedAdAt = null;
            previousSecondsUntil = null;
            lastLoggedSecondsUntil = null;
        }

        Logger.log(`[AdPoller] -- Poll #${pollCount} done. Next poll in ${currentPollMs / 1000}s --`);

    } catch (err) {
        Logger.error(`[AdPoller] Failed: ${err.response?.data || err.message || err}`);
        Logger.log(`[AdPoller] -- Poll #${pollCount} done (errored). Next poll in ${currentPollMs / 1000}s --`);
    }
}

//---------------------ADAPTIVE SCHEDULER---------------------

function scheduleNextPoll(client, config) {
    Logger.log(`[AdPoller] Scheduling next poll in ${currentPollMs / 1000}s`);

    adaptiveInterval = setTimeout(async () => {
        if (!getIsOnline()) {
            Logger.log('[AdPoller] Stream is offline at scheduled poll time, skipping and NOT rescheduling. Poller idle until next onOnline().');
            return;
        }

        await doPoll(client, config);
        scheduleNextPoll(client, config);
    }, currentPollMs);
}

//---------------------START  /  STOP---------------------

function beginPolling(client, config) {
    if (adaptiveInterval || startupTimeout) {
        Logger.log('[AdPoller] beginPolling called but already running or in startup window, ignoring');
        return;
    }

    Logger.log('[AdPoller] Waiting 60s before activation...');

    startupTimeout = setTimeout(() => {
        startupTimeout = null;

        if (!getIsOnline()) {
            Logger.log('[AdPoller] Stream went offline before startup, aborting');
            return;
        }

        pollCount = 0;
        currentPollMs = 15_000;
        lastLoggedSecondsUntil = null;
        Logger.log('[AdPoller] Started');
        scheduleNextPoll(client, config);
    }, 60_000);
}

function stopPolling() {
    if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
        Logger.log('[AdPoller] Cancelled startup window');
    }

    if (adaptiveInterval) {
        clearTimeout(adaptiveInterval);
        adaptiveInterval = null;
    }

    Logger.log(`[AdPoller] Stopping. Final state: pollCount=${pollCount}, warnedAdAt=${warnedAdAt ?? 'null'}`);

    warnedAdAt = null;
    currentPollMs = 15_000;
    lastLoggedSecondsUntil = null;
    previousSecondsUntil = null;

    Logger.log('[AdPoller] Stopped');
}

//---------------------ENTRY POINT---------------------

function startAdSchedulePoller(client, config) {
    onOnline(() => {
        Logger.log('[AdPoller] onOnline fired, calling beginPolling');
        beginPolling(client, config);
    });
    onOffline(() => {
        Logger.log('[AdPoller] onOffline fired, calling stopPolling');
        stopPolling();
    });

    if (getIsOnline()) {
        Logger.log('[AdPoller] Already online at startAdSchedulePoller, beginning immediately');
        beginPolling(client, config);
    } else {
        Logger.log('[AdPoller] Waiting for stream to go online...');
    }
}

module.exports = {
    startAdSchedulePoller,
    stopAdSchedulePoller: stopPolling
};
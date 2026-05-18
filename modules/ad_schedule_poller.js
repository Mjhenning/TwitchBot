// modules/ad_schedule_poller.js
const axios = require('axios');
const {
    getIsOnline,
    onOnline,
    onOffline
} = require('./stream-state');

let pollInterval = null;

const WARN_SECONDS_BEFORE = 90;

// Track exact ad timestamp warned for
let warnedAdAt = null;

async function getAdSchedule(config) {
    const res = await axios.get(
        'https://api.twitch.tv/helix/channels/ads',
        {
            params: {
                broadcaster_id: config.CHANNEL_ID
            },
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
            }
        }
    );

    return res.data?.data?.[0] ?? null;
}

function beginPolling(client, config) {
    // Prevent duplicates
    if (pollInterval) return;

    console.log('[AdPoller] Waiting 60s before activation...');

    setTimeout(() => {
        if (!getIsOnline()) {
            console.log('[AdPoller] Stream went offline before startup');
            return;
        }

        console.log('[AdPoller] Started');

        pollInterval = setInterval(async () => {
            try {
                const adData = await getAdSchedule(config);

                if (!adData?.next_ad_at) {
                    console.log('[AdPoller] No scheduled ad');
                    return;
                }

                const secondsUntil =
                    Math.floor(
                        (new Date(adData.next_ad_at).getTime() - Date.now()) / 1000
                    );

                console.log(`[AdPoller] Next ad in ${secondsUntil}s`);

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

            } catch (err) {
                console.error(
                    '[AdPoller] Failed:',
                    err.response?.data || err.message || err
                );
            }
        }, 15_000);

    }, 60_000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    warnedAdAt = null;

    console.log('[AdPoller] Stopped');
}

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
    startAdSchedulePoller
};
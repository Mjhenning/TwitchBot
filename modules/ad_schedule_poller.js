// modules/ad_schedule_poller.js
const axios = require('axios');

let pollInterval = null;
const WARN_SECONDS_BEFORE = 50; // warn 50 seconds out
let hasWarnedForCurrentBreak = false;

async function getNextAdAt(config) {
    const res = await axios.get(
        'https://api.twitch.tv/helix/channels/ads',
        {
            params: { broadcaster_id: config.CHANNEL_ID },
            headers: {
                'Client-ID':     config.CLIENT_ID,
                'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
            }
        }
    );
    return res.data?.data?.[0]?.next_ad_at ?? null; // ISO string or null
}

function startAdSchedulePoller(client, config) {
    pollInterval = setInterval(async () => {
        try {
            const nextAdAt = await getNextAdAt(config);
            if (!nextAdAt) return;

            const secondsUntil = (new Date(nextAdAt) - Date.now()) / 1000;

            if (secondsUntil > 0 && secondsUntil <= WARN_SECONDS_BEFORE && !hasWarnedForCurrentBreak) {
                hasWarnedForCurrentBreak = true;
                const mins = Math.round(secondsUntil / 60);
                console.log(`AdPoller: Ad break in ~${Math.round(secondsUntil)}s`);
                client.say(
                    `#${config.CHANNEL_NAME}`,
                    `⚠️ Bitrot interference nearing the Glosso-Sphere in ~${mins} minute${mins !== 1 ? 's' : ''}! Finish your messages and stay connected 📡`
                ).catch(err => console.error('AdPoller: Warning message failed:', err));
            }

            // Reset flag once the ad has passed so the next break can warn again
            if (secondsUntil < 0) {
                hasWarnedForCurrentBreak = false;
            }
        } catch (err) {
            console.error('AdPoller: Failed to fetch ad schedule:', err.response?.data || err);
        }
    }, 30_000); // poll every 30 seconds

    console.log('AdPoller: Started');
}

function stopAdSchedulePoller() {
    clearInterval(pollInterval);
    console.log('AdPoller: Stopped');
}

module.exports = { startAdSchedulePoller, stopAdSchedulePoller };
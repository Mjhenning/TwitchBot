// modules/functions/announcement.js
// Sends the official Twitch /announcement (colored chat notice) instead of a plain chat message.
const axios = require("axios");
const {refreshBotToken, withTokenRetry} = require('../../auth');
const {Logger} = require('../../services');

const ANNOUNCE_URL = 'https://api.twitch.tv/helix/chat/announcements';
const MAX_LENGTH = 500; // twitch truncates anything longer
const DEFAULT_COLOR = 'orange'; // blue, green, orange, purple, primary

async function sendAnnouncement(config, message, color = DEFAULT_COLOR) {
    const text = String(message ?? '').slice(0, MAX_LENGTH);

    if (!text.trim()) {
        Logger.warn('[Announcement] skipped, empty message');
        return;
    }

    try {
        await withTokenRetry(async () => {
            await axios.post(
                ANNOUNCE_URL,
                {message: text, color},
                {
                    params: {
                        broadcaster_id: config.BROADCASTER_ID,
                        moderator_id: config.BOT_ID
                    },
                    headers: {
                        'Client-ID': config.CLIENT_ID,
                        'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                    }
                }
            );
        }, refreshBotToken);
        Logger.log('[Announcement] official /announcement sent.');
    } catch (err) {
        if (err.response?.status === 429) {
            Logger.warn('[Announcement] /announcement skipped, cooldown active');
        } else {
            Logger.error(`[Announcement] API error: ${err.response?.data || err}`);
        }
    }
}

module.exports = {sendAnnouncement};

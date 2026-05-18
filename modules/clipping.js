const axios = require('axios');

async function createClip(config) {
    try {
        const res = await axios.post(
            'https://api.twitch.tv/helix/clips',
            null,
            {
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                },
                params: {
                    broadcaster_id: config.CHANNEL_ID
                }
            }
        );

        if (!res.data.data || res.data.data.length === 0) {
            return null;
        }

        const clipId = res.data.data[0].id;
        return `https://clips.twitch.tv/${clipId}`;

    } catch (err) {
        console.error('Clip error:', err.response?.data || err);
        return null;
    }
}

module.exports = { createClip };
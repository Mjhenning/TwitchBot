// modules/followage.js
const axios = require('axios');

async function getFollowage(userId, config) {
    try {
        const res = await axios.get(
            'https://api.twitch.tv/helix/channels/followers',
            {
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                },
                params: {
                    broadcaster_id: config.BROADCASTER_ID,
                    user_id: userId
                }
            }
        );

        if (!res.data.data || res.data.data.length === 0) {
            return null;
        }

        const followedAt = new Date(res.data.data[0].followed_at);
        const now = new Date();
        const diffMs = now - followedAt;

        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        return parts.join(' ') || 'less than a minute';

    } catch (err) {
        console.error('Error in getFollowage:', err.response?.data || err);
        return null;
    }
}

module.exports = {getFollowage};

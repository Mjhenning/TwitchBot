const axios = require('axios');

async function updateRedemptionStatus(config, rewardId, redemptionId, status) {
    try {
        await axios.patch(
            'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions',
            {status},
            {
                params: {broadcaster_id: config.BROADCASTER_ID, reward_id: rewardId, id: redemptionId},
                headers: {
                    Authorization: `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`,
                    'Client-Id': config.CLIENT_ID,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (err) {
        throw new Error(`Helix update redemption failed: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
    }
}

async function getRedemptionStatus(config, rewardId, redemptionId) {
    try {
        const res = await axios.get(
            'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions',
            {
                params: {broadcaster_id: config.BROADCASTER_ID, reward_id: rewardId, id: redemptionId},
                headers: {Authorization: `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`, 'Client-Id': config.CLIENT_ID},
            }
        );
        const data = res.data?.data;
        return data?.length ? data[0].status : 'unknown';
    } catch (err) {
        throw new Error(`Helix get redemption failed: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
    }
}

async function setRewardPaused(config, rewardId, isPaused) {
    try {
        await axios.patch(
            'https://api.twitch.tv/helix/channel_points/custom_rewards',
            {is_paused: isPaused},
            {
                params: {broadcaster_id: config.BROADCASTER_ID, id: rewardId},
                headers: {
                    Authorization: `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`,
                    'Client-Id': config.CLIENT_ID,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (err) {
        throw new Error(`Helix set reward paused failed: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
    }
}

module.exports = {updateRedemptionStatus, getRedemptionStatus, setRewardPaused};
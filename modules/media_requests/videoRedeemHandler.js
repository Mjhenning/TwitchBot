const {registerSubscription} = require('../helpers/eventsub/core');
const {extractRedeemUrl, ValidationError} = require('../moderation/link_filter');
const {fetchMetadata, MetadataError} = require('./metadataService');
const {downloadVideo, deleteVideo} = require('./downloadService');
const {updateRedemptionStatus, getRedemptionStatus} = require('../helpers/twitchRedemption');
const {setPending, getPending, deletePending, getAllPending} = require('./pendingStore');
const playbackManager = require('./playbackManager');

const MAX_PENDING_AGE_MS = 60 * 60 * 1000; // 1 hour

const isExpired = (entry) => Date.now() - entry.createdAt > MAX_PENDING_AGE_MS;

async function autoReject(config, rewardId, redemptionId, reason) {
    console.warn(`[VideoRedeem] auto-rejecting ${redemptionId}: ${reason}`);
    await updateRedemptionStatus(config, rewardId, redemptionId, 'CANCELED');
}

async function expireEntry(config, redemptionId, entry) {
    console.warn(`[VideoRedeem] ${redemptionId} expired — auto-rejecting`);
    await deletePending(redemptionId);
    await autoReject(config, entry.rewardId, redemptionId, 'expired');
    await deleteVideo(redemptionId);
}

async function resolveEntry(config, redemptionId, entry, status) {
    if (status === 'fulfilled') {
        console.log(`[VideoRedeem] ${redemptionId} approved — playing`);
        await playbackManager.play({
            redemptionId, filePath: entry.filePath, title: entry.metadata.title, userName: entry.userName,
        });
    } else if (status === 'canceled') {
        console.log(`[VideoRedeem] ${redemptionId} rejected by mod — deleting file`);
        await deleteVideo(redemptionId);
    }
}

async function onRedemptionAdd(event, client, config) {
    const {id: redemptionId, reward, user_name: userName, user_input: userInput} = event;

    let url;
    try {
        url = extractRedeemUrl(userInput);
    } catch (err) {
        if (err instanceof ValidationError) return autoReject(config, reward.id, redemptionId, err.reason);
        throw err;
    }

    let metadata;
    try {
        metadata = await fetchMetadata(url);
    } catch (err) {
        if (err instanceof MetadataError) return autoReject(config, reward.id, redemptionId, err.reason);
        throw err;
    }

    let filePath;
    try {
        filePath = await downloadVideo(url, redemptionId);
    } catch (err) {
        console.error(`[VideoRedeem] download failed for ${redemptionId}:`, err.message);
        return autoReject(config, reward.id, redemptionId, 'download_failed');
    }

    await setPending(redemptionId, {userName, filePath, metadata, rewardId: reward.id, createdAt: Date.now()});
    console.log(`[VideoRedeem] ${redemptionId} ready — "${metadata.title}" awaiting mod decision`);

    client.say(
        config.CHANNEL_NAME,
        `🎬 ${userName}'s video is downloaded and waiting for a moderator's approval.`
    );
}

async function onRedemptionUpdate(event, client, config) {
    const redemptionId = event.id;
    const entry = await getPending(redemptionId);
    if (!entry) return; // not tracked, or already resolved elsewhere

    await deletePending(redemptionId);
    await resolveEntry(config, redemptionId, entry, event.status);
}

// Self-registers on require, same pattern as your other redeem-type modules.
registerSubscription(
    'channel.channel_points_custom_reward_redemption.add',
    '1',
    (config) => ({broadcaster_user_id: config.BROADCASTER_ID, reward_id: config.MR_REDEEM_ID}),
    onRedemptionAdd
);
registerSubscription(
    'channel.channel_points_custom_reward_redemption.update',
    '1',
    (config) => ({broadcaster_user_id: config.BROADCASTER_ID, reward_id: config.MR_REDEEM_ID}),
    onRedemptionUpdate
);

async function reconcilePendingOnStartup(config) {
    const pending = await getAllPending();
    if (pending.length === 0) return;
    console.log(`[VideoRedeem] reconciling ${pending.length} pending redemption(s) after restart`);

    for (const {redemptionId, ...entry} of pending) {
        try {
            if (isExpired(entry)) {
                await expireEntry(config, redemptionId, entry);
                continue;
            }

            const status = await getRedemptionStatus(config, entry.rewardId, redemptionId);
            if (status === 'unfulfilled') {
                console.log(`[VideoRedeem] ${redemptionId} still pending`);
                continue;
            }

            await deletePending(redemptionId);
            await resolveEntry(config, redemptionId, entry, status);
        } catch (err) {
            console.error(`[VideoRedeem] reconcile failed for ${redemptionId}:`, err.message);
        }
    }
}

let sweepInterval = null;

function startExpirySweep(config, intervalMs = 5 * 60 * 1000) {
    if (sweepInterval) return;
    sweepInterval = setInterval(async () => {
        try {
            const pending = await getAllPending();
            for (const {redemptionId, ...entry} of pending) {
                if (isExpired(entry)) await expireEntry(config, redemptionId, entry);
            }
        } catch (err) {
            console.error('[VideoRedeem] expiry sweep failed:', err.message);
        }
    }, intervalMs);
}

function stopExpirySweep() {
    clearInterval(sweepInterval);
    sweepInterval = null;
}

module.exports = {reconcilePendingOnStartup, startExpirySweep, stopExpirySweep};
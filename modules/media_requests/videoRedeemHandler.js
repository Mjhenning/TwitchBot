const {registerReward, reconcilePendingOnStartup, startExpirySweep, stopExpirySweep} = require('../helpers/twitchRedemption');
const {extractRedeemUrl} = require('../moderation/link_filter');
const {fetchMetadata} = require('./metadataService');
const {downloadVideo, deleteVideo} = require('./downloadService');
const playbackManager = require('./playbackManager');
const {config} = require('../../config');
const {Logger} = require('../../services');

// Self-registers with the redemption dispatcher; future rewards just add
// their own registerReward call in a new module.
registerReward({
    rewardId: config.MR_REDEEM_ID,
    name: 'VideoRedeem',
    startClosed: true, // paused by default, opened with !openmr

    // Runs on the "add" event. Downloads the clip, then returns the pending
    // entry stored for mod approval. Errors with a .reason auto-reject instead.
    onRedeem: async ({redemptionId, userInput, userName}, client, cfg) => {
        // ValidationError and MetadataError carry .reason; dispatcher auto-rejects on them.
        const url = extractRedeemUrl(userInput);
        const metadata = await fetchMetadata(url);

        let filePath;
        try {
            filePath = await downloadVideo(url, redemptionId);
        } catch (err) {
            Logger.error(`[VideoRedeem] download failed for ${redemptionId}: ${err.message}`);
            const e = new Error('download_failed');
            e.reason = 'download_failed';
            throw e;
        }

        client.say(
            cfg.CHANNEL_NAME,
            `🎬 ${userName}'s video is downloaded and waiting for a moderator's approval.`
        );

        return {filePath, metadata};
    },

    // Runs when a mod approves the pending clip.
    onResolve: async (entry, event, client, cfg) => {
        Logger.log(`[VideoRedeem] ${entry.redemptionId} approved, playing`);
        await playbackManager.play({
            redemptionId: entry.redemptionId,
            filePath: entry.filePath,
            title: entry.metadata.title,
            userName: entry.userName
        });
    },

    // Runs when a mod rejects the pending clip.
    onReject: async (entry) => {
        Logger.log(`[VideoRedeem] ${entry.redemptionId} rejected by mod, deleting file`);
        await deleteVideo(entry.redemptionId);
    },

    // Runs when a pending clip expires before a decision.
    onExpire: async (entry, client, cfg) => {
        await deleteVideo(entry.redemptionId);
    }
});

// Kept exported for bot.js lifecycle; all delegate to the dispatcher.
module.exports = {reconcilePendingOnStartup, startExpirySweep, stopExpirySweep};

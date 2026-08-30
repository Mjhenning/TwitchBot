// modules/GlosselsRedeem
const {registerReward} = require('../../helpers/twitchRedemption');
const {addGlossels} = require('./glossels');
const {config} = require('../../../config');
const {Logger} = require('../../../services');

// ---------------- CONFIG ----------------
const POINTS_COST = 1000; // Twitch redeem cost, used only for messaging
const YIELD = 50; // Glossels granted per redeem (fixed static ratio)

// ---------------- REWARD ----------------
// Converts channel points into Glossels. Twitch enforces the per-user per-stream
// limit and the skip-approval queue (no input, no mod review), so this only
// grants flat-rate on each add event.
registerReward({
    rewardId: config.GLOSSELS_REDEEM_ID,
    name: 'PointsToGlossels',
    startClosed: false, // always open
    autoFulfill: false, // reward uses Twitch skip-approval queue, already accepted

    onRedeem: async ({userId, userName}, client, cfg) => {
        const balance = addGlossels(userId, YIELD, userName);

        Logger.log(`[GlosselsRedeem] ${userName} converted points to ${YIELD} Glossels, balance ${balance}`);

        client.say(cfg.CHANNEL_NAME, `🫧 ${userName} converted ${POINTS_COST} channel points into ${YIELD} Glossels. Balance: ${balance}.`);
    }
});

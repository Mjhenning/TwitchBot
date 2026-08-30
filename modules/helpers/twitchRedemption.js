const axios = require('axios');
const {Logger} = require('../../services');
const {setPending, getPending, deletePending, getAllPending} = require('../media_requests/pendingStore');

// Registry of reward modules, keyed by Twitch reward id.
// Each entry: { rewardId, name, startClosed, onRedeem, onResolve?, onReject?, onExpire? }
const rewards = new Map();

// Open/closed state per reward, set by the open/close commands or startup sync.
const rewardStates = new Map(); // rewardId -> boolean (open)

const MAX_PENDING_AGE_MS = 60 * 60 * 1000; // 1 hour

const isExpired = (entry) => Date.now() - entry.createdAt > MAX_PENDING_AGE_MS;

// Register a reward module. The presence of onResolve opts into the mod-approval
// flow; without it the reward is fulfilled instantly on redeem. startClosed tells
// applyStartupStates to pause the reward on bot start.
function registerReward({rewardId, name, startClosed = false, onRedeem, onResolve, onReject, onExpire}) {
    if (!rewardId || !onRedeem) {
        Logger.error(`[Redemption] registerReward skipped, missing rewardId or onRedeem for "${name || 'untitled'}"`);
        return;
    }
    rewards.set(rewardId, {rewardId, name, startClosed, onRedeem, onResolve, onReject, onExpire});
    Logger.log(`[Redemption] Registered reward "${name}" (${rewardId})`);
}

async function autoFulfill(config, rewardId, redemptionId) {
    return updateRedemptionStatus(config, rewardId, redemptionId, 'FULFILLED');
}

async function autoReject(config, rewardId, redemptionId, reason) {
    Logger.warn(`[Redemption] auto-rejecting ${redemptionId}: ${reason}`);
    return updateRedemptionStatus(config, rewardId, redemptionId, 'CANCELED');
}

// Route an "add" notification to the matching reward module.
async function handleRedeemAdd(event, client, config) {
    const {id: redemptionId, reward, user_id: userId, user_name: userName, user_input: userInput} = event;
    const rewardId = reward?.id;
    const rewardDef = rewards.get(rewardId);

    if (!rewardDef) {
        Logger.warn(`[Redemption] No reward module registered for reward_id ${rewardId}`);
        return;
    }

    let entry;
    try {
        entry = await rewardDef.onRedeem({redemptionId, rewardId, reward, userId, userName, userInput, raw: event}, client, config);
    } catch (err) {
        const reason = err?.reason || err?.message || 'redeem_failed';
        return autoReject(config, rewardId, redemptionId, reason);
    }

    // onResolve present means the reward waits for mod approval.
    if (rewardDef.onResolve) {
        await setPending(redemptionId, {redemptionId, rewardId, userName, createdAt: Date.now(), ...(entry || {})});
        return;
    }

    // No onResolve: instant reward, fulfil immediately.
    await autoFulfill(config, rewardId, redemptionId);
}

// Route an "update" notification (mod fulfill/reject) to the pending reward module.
async function handleRedeemUpdate(event, client, config) {
    const redemptionId = event.id;
    const entry = await getPending(redemptionId);
    if (!entry) return; // not tracked, or already resolved elsewhere

    await deletePending(redemptionId);
    await dispatchResolve(config, client, redemptionId, entry, {status: event.status});
}

// Open a reward: unpause on Twitch and record the open state.
async function openReward(config, rewardId) {
    await setRewardPaused(config, rewardId, false);
    rewardStates.set(rewardId, true);
    Logger.log(`[Redemption] Reward ${rewardId} opened`);
}

// Close a reward: pause on Twitch and record the closed state.
async function closeReward(config, rewardId) {
    await setRewardPaused(config, rewardId, true);
    rewardStates.set(rewardId, false);
    Logger.log(`[Redemption] Reward ${rewardId} closed`);
}

function isRewardOpen(rewardId) {
    return rewardStates.get(rewardId) ?? false;
}

// Apply each registered reward's declared startup state.
async function applyStartupStates(config) {
    for (const reward of rewards.values()) {
        if (reward.startClosed) {
            try {
                await closeReward(config, reward.rewardId);
            } catch (err) {
                Logger.error(`[Redemption] Failed to close "${reward.name}" on startup: ${err.message}`);
            }
        }
    }
}

function resetRewardStates() {
    rewardStates.clear();
}

async function expireEntry(config, client, redemptionId, entry) {
    Logger.warn(`[Redemption] ${redemptionId} expired, auto-rejecting`);
    await deletePending(redemptionId);
    await autoReject(config, entry.rewardId, redemptionId, 'expired');

    const rewardDef = rewards.get(entry.rewardId);
    if (rewardDef?.onExpire) {
        await rewardDef.onExpire(entry, client, config);
    }
}

// Reconcile any pending redemptions left over from a previous run.
async function reconcilePendingOnStartup(config, client) {
    const pending = await getAllPending();
    if (pending.length === 0) return;
    Logger.log(`[Redemption] reconciling ${pending.length} pending redemption(s) after restart`);

    for (const {redemptionId, ...entry} of pending) {
        try {
            if (isExpired(entry)) {
                await expireEntry(config, client, redemptionId, entry);
                continue;
            }

            const status = await getRedemptionStatus(config, entry.rewardId, redemptionId);
            if (status === 'unfulfilled') {
                Logger.log(`[Redemption] ${redemptionId} still pending`);
                continue;
            }

            await deletePending(redemptionId);
            await dispatchResolve(config, client, redemptionId, entry, {status});
        } catch (err) {
            Logger.error(`[Redemption] reconcile failed for ${redemptionId}: ${err.message}`);
        }
    }
}

async function dispatchResolve(config, client, redemptionId, entry, event) {
    const rewardDef = rewards.get(entry.rewardId);
    if (!rewardDef) return;

    if (event.status === 'fulfilled' && rewardDef.onResolve) {
        await rewardDef.onResolve(entry, event, client, config);
    } else if (event.status === 'canceled' && rewardDef.onReject) {
        await rewardDef.onReject(entry, event, client, config);
    }
}

let sweepInterval = null;

function startExpirySweep(config, client, intervalMs = 5 * 60 * 1000) {
    if (sweepInterval) return;
    sweepInterval = setInterval(async () => {
        try {
            const pending = await getAllPending();
            for (const {redemptionId, ...entry} of pending) {
                if (isExpired(entry)) await expireEntry(config, client, redemptionId, entry);
            }
        } catch (err) {
            Logger.error(`[Redemption] expiry sweep failed: ${err.message}`);
        }
    }, intervalMs);
}

function stopExpirySweep() {
    clearInterval(sweepInterval);
    sweepInterval = null;
}

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

module.exports = {
    updateRedemptionStatus,
    getRedemptionStatus,
    setRewardPaused,
    registerReward,
    handleRedeemAdd,
    handleRedeemUpdate,
    openReward,
    closeReward,
    isRewardOpen,
    applyStartupStates,
    resetRewardStates,
    reconcilePendingOnStartup,
    startExpirySweep,
    stopExpirySweep
};

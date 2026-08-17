// bot.js
const tmi = require('tmi.js');
const {initTokens, refreshBroadcasterToken} = require('./auth');
const {startShieldSystem, stopShieldSystem} = require('./modules/helpers/shield_system');
const {startTimers, stopTimers} = require('./modules/helpers/timer');
const {startAdSchedulePoller, stopAdSchedulePoller} = require('./modules/helpers/ad_schedule_poller');
const {resetListeners} = require('./modules/helpers/stream-state');
const {stopSSRPolling} = require('./modules/song_requests/pear-desktop-music');

const {setupChatCommands} = require('./commands/chat_integration');
const {startARGElements, sysResetSession} = require('./ARG/modules/arg_main');
const {startOBSWatcher} = require('./obs_watcher');
const {clearCooldowns} = require("./modules/helpers/cooldown");

const {clearLurkers} = require('./modules/functions/lurk_tracker');
const {resetCommandState} = require('./commands/registry');

const {reconcilePendingOnStartup, startExpirySweep} = require('./modules/media_requests/videoRedeemHandler');
const {setRewardPaused} = require('./modules/helpers/twitchRedemption');

const {startEventSub, stopEventSub} = require('./modules/helpers/eventsub/core');
require('./modules/helpers/eventsub/handlers');

let tmiClient = null;
let isRunning = false;
let tokenRefreshInterval = null;

async function startBot() {
    if (isRunning) {
        console.log('[Bot] Already running, skipping start');
        return;
    }
    isRunning = true;
    console.log('[Bot] Starting...');

    try {
        const cfg = await initTokens();

        // Proactively refresh every 3 hours so long streams don't hit token expiry
        if (!tokenRefreshInterval) {
            tokenRefreshInterval = setInterval(async () => {
                try {
                    await refreshBroadcasterToken();
                    console.log('[Auth] Broadcaster token proactively refreshed');
                } catch (err) {
                    console.error('[Auth] Broadcaster token refresh failed:', err.message);
                }
            }, 1000 * 60 * 60 * 3);
        }

        tmiClient = new tmi.Client({
            identity: {
                username: cfg.BOT_NAME,
                password: cfg.BOT_OAUTH_TOKEN
            },
            channels: [cfg.CHANNEL_NAME],
            connection: {reconnect: true},
            logger: {
                info: console.log,
                warn: console.warn,
                error: (msg) => {
                    if (typeof msg === 'string' && msg.includes('No response from Twitch')) return;
                    console.error(msg);
                }
            }
        });

        await tmiClient.connect();

        tmiClient.on('connected', (address, port) => {
            console.log(`[Bot] Chat connected (${cfg.BOT_NAME}) on ${address}:${port}`);
        });

        startShieldSystem(tmiClient, cfg);
        await startEventSub(tmiClient, cfg);
        await reconcilePendingOnStartup(cfg);
        startExpirySweep(cfg);

        try {
            await setRewardPaused(cfg, cfg.MR_REDEEM_ID, true);
            console.log('[Bot] Media request reward paused on startup (matches default-closed state)');
        } catch (err) {
            console.error('[Bot] Failed to pause media request reward on startup:', err.message);
        }

        startAdSchedulePoller(tmiClient, cfg);
        startTimers(tmiClient, cfg.CHANNEL_NAME);
        setupChatCommands(tmiClient, cfg);
        startARGElements(tmiClient, cfg);

        console.log('[Bot] All modules running');
    } catch (err) {
        console.error('[Bot] Failed to start:', err);
        isRunning = false;
    }
}

async function stopBot() {
    if (!isRunning) {
        console.log('[Bot] Already stopped, skipping teardown');
        return;
    }
    isRunning = false;
    console.log('[Bot] Stopping...');

    try {
        stopShieldSystem();
    } catch (e) {
        console.error('[Bot] stopShieldSystem error:', e);
    }
    try {
        stopEventSub();
    } catch (e) {
        console.error('[Bot] stopEventSub error:', e);
    }
    try {
        const {stopExpirySweep} = require('./modules/media_requests/videoRedeemHandler');
        stopExpirySweep();
    } catch (e) {
        console.error('[Bot] stopExpirySweep error:', e);
    }
    try {
        const playbackManager = require('./modules/media_requests/playbackManager');
        await playbackManager.forceStop();
    } catch (e) {
        console.error('[Bot] playbackManager.forceStop error:', e);
    }
    try {
        stopAdSchedulePoller();
    } catch (e) {
        console.error('[Bot] stopAdPoller error:', e);
    }
    try {
        stopTimers();
    } catch (e) {
        console.error('[Bot] stopTimers error:', e);
    }
    try {
        stopSSRPolling();
    } catch (e) {
        console.error('[Bot] stopSSRPolling error:', e);
    }
    try {
        sysResetSession();
    } catch (e) {
        console.error('[Bot] sysResetSession error:', e);
    }
    try {
        clearCooldowns()
    } catch (e) {
        console.error('[Bot] clearCooldowns error:', e);
    }
    try {
        clearLurkers();
    } catch (e) {
        console.error('[Bot] clearLurkers error:', e);
    }
    try {
        resetCommandState();
    } catch (e) {
        console.error('[Bot] resetCommandState error:', e);
    }

    resetListeners(); //clear stream-state listener arrays before next startBot()

    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
    }

    if (tmiClient) {
        try {
            tmiClient.removeAllListeners();
            await tmiClient.disconnect();
        } catch (e) {
            console.error('[Bot] tmi disconnect error:', e);
        }
        tmiClient = null;
    }

    console.log('[Bot] Stopped');
}

startOBSWatcher({
    onOBSOnline: startBot,
    onOBSOFfline: stopBot,
});
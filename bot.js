// bot.js
const tmi = require('tmi.js');
const {Logger} = require('./services');
const {initTokens, refreshBroadcasterToken, refreshBotToken} = require('./auth');
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
require('./modules/functions/currency/glosselsRedeemHandler'); // self-registers its reward
const {applyStartupStates} = require('./modules/helpers/twitchRedemption');

const {startEventSub, stopEventSub} = require('./modules/helpers/eventsub/core');
require('./modules/helpers/eventsub/handlers');

const {startTop10OverlayServer} = require('./modules/helpers/top10_overlay_server');

let tmiClient = null;
let isRunning = false;
let tokenRefreshInterval = null;

async function startBot() {
    if (isRunning) {
        Logger.log('[Bot] Already running, skipping start');
        return;
    }
    isRunning = true;
    Logger.log('[Bot] Starting...');

    try {
        const cfg = await initTokens();

        // Proactively refresh every 3 hours so long streams don't hit token expiry
        if (!tokenRefreshInterval) {
            tokenRefreshInterval = setInterval(async () => {
                try {
                    await refreshBroadcasterToken();
                    Logger.log('[Auth] Broadcaster token proactively refreshed');
                } catch (err) {
                    Logger.error(`[Auth] Broadcaster token refresh failed: ${err.message}`);
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
                info: Logger.log,
                warn: Logger.warn,
                error: (msg) => {
                    if (typeof msg === 'string' && msg.includes('No response from Twitch')) return;
                    Logger.error(msg);
                }
            }
        });

        await tmiClient.connect();

        let recovering = false;
        const recoverChatAuth = async (reason) => {
            if (recovering) return;
            if (!/login|authenticat|Unable to authenticate/i.test(reason || '')) return;
            recovering = true;
            Logger.warn(`[Bot] Chat auth rejected (${reason}), refreshing bot token and reconnecting...`);
            try {
                await refreshBotToken();
                tmiClient.opts.identity.password = cfg.BOT_OAUTH_TOKEN;
                tmiClient.reconnect = true;
                await tmiClient.connect();
                Logger.log('[Bot] Chat reconnected after token refresh');
            } catch (err) {
                Logger.error(`[Bot] Chat auth recovery failed: ${err.message}`);
                tmiClient.reconnect = true;
            } finally {
                recovering = false;
            }
        };

        tmiClient.on('connected', (address, port) => {
            Logger.log(`[Bot] Chat connected (${cfg.BOT_NAME}) on ${address}:${port}`);
        });

        tmiClient.on('disconnected', (reason) => {
            recoverChatAuth(reason);
        });

        startShieldSystem(tmiClient, cfg);
        await startEventSub(tmiClient, cfg);
        await reconcilePendingOnStartup(cfg);
        startExpirySweep(cfg);

        try {
            await applyStartupStates(cfg);
            Logger.log('[Bot] Applied per-reward startup states');
        } catch (err) {
            Logger.error(`[Bot] Failed to apply reward startup states: ${err.message}`);
        }

        startAdSchedulePoller(tmiClient, cfg);
        startTimers(tmiClient, cfg.CHANNEL_NAME);
        setupChatCommands(tmiClient, cfg);
        startARGElements(tmiClient, cfg);
        startTop10OverlayServer({
            getAccessToken: () => cfg.APP_TOKEN, // fetched by initTokens
            clientId: cfg.CLIENT_ID,
        });

        Logger.log('[Bot] All modules running');
    } catch (err) {
        Logger.error(`[Bot] Failed to start: ${err}`);
        isRunning = false;
    }
}

async function stopBot() {
    if (!isRunning) {
        Logger.log('[Bot] Already stopped, skipping teardown');
        return;
    }
    isRunning = false;
    Logger.log('[Bot] Stopping...');

    try {
        stopShieldSystem();
    } catch (e) {
        Logger.error(`[Bot] stopShieldSystem error: ${e}`);
    }
    try {
        stopEventSub();
    } catch (e) {
        Logger.error(`[Bot] stopEventSub error: ${e}`);
    }
    try {
        const {stopExpirySweep} = require('./modules/media_requests/videoRedeemHandler');
        stopExpirySweep();
    } catch (e) {
        Logger.error(`[Bot] stopExpirySweep error: ${e}`);
    }
    try {
        const playbackManager = require('./modules/media_requests/playbackManager');
        await playbackManager.forceStop();
    } catch (e) {
        Logger.error(`[Bot] playbackManager.forceStop error: ${e}`);
    }
    try {
        stopAdSchedulePoller();
    } catch (e) {
        Logger.error(`[Bot] stopAdPoller error: ${e}`);
    }
    try {
        stopTimers();
    } catch (e) {
        Logger.error(`[Bot] stopTimers error: ${e}`);
    }
    try {
        stopSSRPolling();
    } catch (e) {
        Logger.error(`[Bot] stopSSRPolling error: ${e}`);
    }
    try {
        sysResetSession();
    } catch (e) {
        Logger.error(`[Bot] sysResetSession error: ${e}`);
    }
    try {
        clearCooldowns()
    } catch (e) {
        Logger.error(`[Bot] clearCooldowns error: ${e}`);
    }
    try {
        clearLurkers();
    } catch (e) {
        Logger.error(`[Bot] clearLurkers error: ${e}`);
    }
    try {
        resetCommandState();
    } catch (e) {
        Logger.error(`[Bot] resetCommandState error: ${e}`);
    }

    resetListeners(); // clear stream-state listener arrays before next startBot()

    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
    }

    if (tmiClient) {
        try {
            tmiClient.removeAllListeners();
            await tmiClient.disconnect();
        } catch (e) {
            Logger.error(`[Bot] tmi disconnect error: ${e}`);
        }
        tmiClient = null;
    }

    Logger.log('[Bot] Stopped');
}

Logger.init();

startOBSWatcher({
    onOBSOnline: startBot,
    onOBSOFfline: stopBot,
});
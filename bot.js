// bot.js
const tmi = require('tmi.js');
const {config, initTokens} = require('./config');
const {startShieldSystem, stopShieldSystem} = require('./modules/shield_system');
const {startTimers, stopTimers} = require('./modules/timer');
const {startAdSchedulePoller, stopAdSchedulePoller} = require('./modules/ad_schedule_poller');
const {startEventSub, stopEventSub} = require('./modules/twitch_events');
const {resetListeners} = require('./modules/stream-state');           // ← new
const {stopSSRPolling} = require('./modules/pear-desktop-music');     // ← new

const {setupChatCommands} = require('./commands/chat_integration');
const {startARGElements} = require('./ARG/modules/arg_main');
const {startOBSWatcher} = require('./obs_watcher');
require('./data/twitch_events_handlers');

let tmiClient = null;
let isRunning = false;

async function startBot() {
    if (isRunning) {
        console.log('[Bot] Already running, skipping start');
        return;
    }
    isRunning = true;
    console.log('[Bot] Starting...');

    try {
        const cfg = await initTokens();

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
    }  // ← new

    resetListeners(); // ← new: clear stream-state listener arrays before next startBot()

    if (tmiClient) {
        try {
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
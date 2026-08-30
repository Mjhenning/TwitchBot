// obs_watcher.js
const OBSWebSocket = require('obs-websocket-js').default;
const {config} = require('./config');
const {Logger} = require('./services');
const RECONNECT_DELAY = 20000;

async function startOBSWatcher({onOBSOnline, onOBSOFfline}) {
    const obs = new OBSWebSocket();
    let connected = false;
    let reconnectTimer = null; // track the single pending retry

    function scheduleReconnect() {
        if (reconnectTimer) return; // prevent duplicate scheduling
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            tryConnect();
        }, RECONNECT_DELAY);
    }

    async function tryConnect() {
        try {
            await obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD || undefined);
        } catch (err) {
            Logger.log(`[OBS] Connection failed (${err.message}), retrying in ${RECONNECT_DELAY / 1000}s...`);
            scheduleReconnect(); // use the guarded scheduler, not setTimeout directly
        }
    }

    obs.on('Identified', () => {
        if (!connected) {
            connected = true;
            Logger.log('[OBS] Connected, starting bot');
            onOBSOnline();
        }
    });

    obs.on('ConnectionClosed', () => {
        if (connected) {
            connected = false;
            Logger.log('[OBS] Disconnected, stopping bot');
            onOBSOFfline();
        }
        scheduleReconnect(); // same guarded scheduler, no duplicate with tryConnect's catch
    });

    obs.on('ConnectionError', (err) => {
        Logger.error(`[OBS] WebSocket error: ${err.message}`);
        // No retry scheduled here, ConnectionClosed handles it
    });

    Logger.log(`[OBS] Watching for OBS at ${config.OBS_WS_URL}...`);
    await tryConnect();
}

module.exports = {startOBSWatcher};
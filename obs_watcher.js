// obs_watcher.js
const OBSWebSocket = require('obs-websocket-js').default;
const {config} = require('./config');
const RECONNECT_DELAY = 5000; // ms between reconnect attempts

async function startOBSWatcher({onOBSOnline, onOBSOFfline}) {
    const obs = new OBSWebSocket();
    let connected = false;

    async function tryConnect() {
        try {
            await obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD || undefined);
            // 'ConnectionOpened' fires before auth, 'Hello'/'Identified' mean we're in
        } catch (err) {
            console.log(`[OBS] Connection failed (${err.message}), retrying in ${RECONNECT_DELAY / 1000}s...`);
            setTimeout(tryConnect, RECONNECT_DELAY);
        }
    }

    obs.on('Identified', () => {
        if (!connected) {
            connected = true;
            console.log('[OBS] Connected — starting bot');
            onOBSOnline();
        }
    });

    obs.on('ConnectionClosed', () => {
        if (connected) {
            connected = false;
            console.log('[OBS] Disconnected — stopping bot');
            onOBSOFfline();
        }
        // Always retry, whether it was a clean close or a crash
        setTimeout(tryConnect, RECONNECT_DELAY);
    });

    obs.on('ConnectionError', (err) => {
        console.error('[OBS] WebSocket error:', err.message);
        // ConnectionClosed fires right after, so retry is handled there
    });

    console.log(`[OBS] Watching for OBS at ${config.OBS_WS_URL}...`);
    await tryConnect();
}

module.exports = {startOBSWatcher};
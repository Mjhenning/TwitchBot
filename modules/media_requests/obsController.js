const OBSWebSocket = require('obs-websocket-js').default;
const {config} = require('../../config');
const {Logger} = require('../../services');

const obs = new OBSWebSocket();
let connected = false;

async function connectObs() {
    if (connected) return;
    await obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD);
    connected = true;
    obs.on('ConnectionClosed', () => {
        connected = false;
        Logger.warn('[OBS] connection closed');
    });
}

async function ensureConnected() {
    if (!connected) await connectObs();
}

// Toggles the media source on the current active scene only. Scene swaps keep
// each item's own enabled state, so enabling on the active scene is enough and
// won't force the source on elsewhere.
async function getActiveSceneItem() {
    const {currentProgramSceneName} = await obs.call('GetCurrentProgramScene');
    const {sceneItems} = await obs.call('GetSceneItemList', {sceneName: currentProgramSceneName});
    const item = sceneItems.find((item) => item.sourceName === config.OBS_SOURCE_NAME) || null;
    return item ? {sceneName: currentProgramSceneName, ...item} : null;
}

async function setMediaGroupVisible(visible) {
    await ensureConnected();
    const target = await getActiveSceneItem();
    if (!target) {
        Logger.warn(`[OBS] source "${config.OBS_SOURCE_NAME}" not found in active scene`);
        return;
    }
    await obs.call('SetSceneItemEnabled', {sceneName: target.sceneName, sceneItemId: target.sceneItemId, sceneItemEnabled: visible});
}

async function enableMediaGroup() {
    await setMediaGroupVisible(true);
}

async function disableMediaGroup() {
    await setMediaGroupVisible(false);
}

module.exports = {connectObs, enableMediaGroup, disableMediaGroup};

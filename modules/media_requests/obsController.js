const OBSWebSocket = require('obs-websocket-js').default;
const {config} = require('../../config');

const obs = new OBSWebSocket();
let connected = false;
let sceneItemId = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectObs() {
    if (connected) return;
    await obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD);
    connected = true;
    obs.on('ConnectionClosed', () => {
        connected = false;
        console.warn('[OBS] connection closed');
    });

    ({sceneItemId} = await obs.call('GetSceneItemId', {
        sceneName: config.OBS_SCENE_NAME,
        sourceName: config.OBS_SOURCE_NAME,
    }));
}

async function ensureConnected() {
    if (!connected) await connectObs();
}

async function enableMediaGroup() {
    await ensureConnected();
    await delay(500);
    await obs.call('SetSceneItemEnabled', {sceneName: config.OBS_SCENE_NAME, sceneItemId, sceneItemEnabled: true});
}

async function disableMediaGroup() {
    await ensureConnected();
    // await delay(500);
    await obs.call('SetSceneItemEnabled', {sceneName: config.OBS_SCENE_NAME, sceneItemId, sceneItemEnabled: false});
}

module.exports = {connectObs, enableMediaGroup, disableMediaGroup};
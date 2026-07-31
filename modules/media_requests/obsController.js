const OBSWebSocket = require('obs-websocket-js').default;
const {config} = require('../../config');

const obs = new OBSWebSocket();
let connected = false;
let groupItemId = null;   // the group's own item, inside the main scene
let sourceItemId = null;  // the media source's item, inside the group

async function connectObs() {
    if (connected) return;
    await obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD);
    connected = true;
    obs.on('ConnectionClosed', () => {
        connected = false;
        console.warn('[OBS] connection closed');
    });

    ({sceneItemId: groupItemId} = await obs.call('GetSceneItemId', {
        sceneName: config.OBS_SCENE_NAME,   // your main scene
        sourceName: config.OBS_GROUP_NAME,  // the group, as an item within that scene
    }));

    ({sceneItemId: sourceItemId} = await obs.call('GetSceneItemId', {
        sceneName: config.OBS_GROUP_NAME,   // the group, treated as its own scene
        sourceName: config.OBS_SOURCE_NAME, // the media source within it
    }));
}

async function ensureConnected() {
    if (!connected) await connectObs();
}

async function enableMediaGroup() {
    await ensureConnected();
    await obs.call('SetSceneItemEnabled', {
        sceneName: config.OBS_SCENE_NAME,
        sceneItemId: groupItemId,
        sceneItemEnabled: true,
    });
    await obs.call('SetSceneItemEnabled', {
        sceneName: config.OBS_GROUP_NAME,
        sceneItemId: sourceItemId,
        sceneItemEnabled: true,
    });
}

async function disableMediaGroup() {
    await ensureConnected();
    await obs.call('SetSceneItemEnabled', {
        sceneName: config.OBS_GROUP_NAME,
        sceneItemId: sourceItemId,
        sceneItemEnabled: false,
    });
    await obs.call('SetSceneItemEnabled', {
        sceneName: config.OBS_SCENE_NAME,
        sceneItemId: groupItemId,
        sceneItemEnabled: false,
    });
}

module.exports = {connectObs, enableMediaGroup, disableMediaGroup};
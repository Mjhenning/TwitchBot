const vlc = require('./vlcController');
const obs = require('./obsController');
const {deleteVideo} = require('./downloadService');
const {Logger} = require('../../services');

const POLL_INTERVAL_MS = 1000;

let current = null; // { redemptionId, filePath, title, userName }
let pollTimer = null;

function isBusy() {
    return current !== null;
}

async function play(entry) {
    if (current) {
        Logger.warn(`[Playback] already playing ${current.redemptionId}, dropping ${entry.redemptionId} (cooldown should prevent this — check reward config if this fires)`);
        await deleteVideo(entry.redemptionId).catch(() => {
        });
        return;
    }

    current = entry;
    Logger.log(`[Playback] starting "${entry.title}" (${entry.redemptionId})`);

    try {
        await obs.enableMediaGroup();
        await vlc.playFile(entry.filePath);
    } catch (err) {
        Logger.error(`[Playback] failed to start ${entry.redemptionId}: ${err.message}`);
        current = null;
        await deleteVideo(entry.redemptionId).catch(() => {
        });
        return;
    }

    pollTimer = setInterval(checkStatus, POLL_INTERVAL_MS);
}

async function checkStatus() {
    if (!current) return;
    try {
        const state = await vlc.getState();
        if (state === 'stopped') await finishCurrent();
    } catch (err) {
        Logger.error(`[Playback] status poll failed: ${err.message}`);
    }
}

async function finishCurrent() {
    clearInterval(pollTimer);
    pollTimer = null;

    const finished = current;
    current = null;
    Logger.log(`[Playback] finished "${finished.title}" (${finished.redemptionId})`);

    try {
        await obs.disableMediaGroup();
    } catch (err) {
        Logger.error(`[Playback] failed to disable OBS group: ${err.message}`);
    }

    await deleteVideo(finished.redemptionId).catch(err =>
        Logger.error(`[Playback] cleanup delete failed: ${err.message}`)
    );
}

async function forceStop() {
    if (!current) return;

    clearInterval(pollTimer);
    pollTimer = null;

    const stopped = current;
    current = null;
    Logger.log(`[Playback] force-stopping "${stopped.title}" (${stopped.redemptionId})`);

    try {
        await vlc.stop();
    } catch (err) {
        Logger.error(`[Playback] force-stop VLC error: ${err.message}`);
    }

    try {
        await obs.disableMediaGroup();
    } catch (err) {
        Logger.error(`[Playback] force-stop OBS disable error: ${err.message}`);
    }

    await deleteVideo(stopped.redemptionId).catch(err =>
        Logger.error(`[Playback] force-stop cleanup delete failed: ${err.message}`)
    );
}

module.exports = {play, isBusy, forceStop};

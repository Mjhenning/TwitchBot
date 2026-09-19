// modules/helpers/session_gates.js
// Persists in-memory stream "gates" (SR open/closed, MR open/closed, ARG
// terminal session, shoutout tracking, lurkers) so a mid-stream bot crash or
// OBS reconnect restores them instead of silently resetting the stream's state.
// The Aetherkey marker appended to the stream title at !sys activation is used as
// the "stream is still the active session" check: a fresh stream usually has a
// fresh title (no marker), so pasted-in gates from an old stream are discarded.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {Logger} = require('../../services');
const {onOffline} = require('./stream-state');
const {withTokenRetry} = require('../../auth');

const GATES_PATH = path.join(__dirname, '../../data/stream_gates.json');

const defaultGates = () => ({
    ssrEnabled: false,
    mrRewardOpen: false,
    terminalActivated: false,
    aetherKeyHolder: null,
    greetedShoutouts: [],
    lurkers: [],
    sysConnectedUsers: [],
    argCwd: '/',
    fullCoherenceAchieved: false
});

function readGates() {
    try {
        const data = JSON.parse(fs.readFileSync(GATES_PATH, 'utf8'));
        return {...defaultGates(), ...data};
    } catch (err) {
        return defaultGates();
    }
}

function writeGates(gates) {
    try {
        fs.writeFileSync(GATES_PATH, JSON.stringify(gates, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[SessionGates] Failed to write ${GATES_PATH}: ${err.message}`);
    }
}

// Mutates a single persisted gate. Written by feature modules on user commands,
// so the file always mirrors the intended state, never the shutdown resets.
function setGate(name, value) {
    writeGates({...readGates(), [name]: value});
}

function clearPersistedGates() {
    writeGates(defaultGates());
    Logger.log('[SessionGates] Persisted gates cleared');
}

// True if the gates file holds anything beyond the defaults (i.e. a session
// snapshot worth restoring).
function hasAnyGate(gates) {
    return gates.terminalActivated
        || !!gates.aetherKeyHolder
        || gates.ssrEnabled
        || gates.mrRewardOpen
        || (gates.greetedShoutouts && gates.greetedShoutouts.length > 0)
        || (gates.lurkers && gates.lurkers.length > 0)
        || (gates.sysConnectedUsers && gates.sysConnectedUsers.length > 0)
        || gates.argCwd !== '/'
        || gates.fullCoherenceAchieved;
}

// The stream title keeps the " | Aetherkey: @user" marker while a session is
// active. A fresh stream usually swaps in a new title, so the marker tells us
// whether persisted gates belong to the current stream or a dead one.
async function streamSessionActive(config) {
    try {
        const res = await withTokenRetry(async () => {
            return axios.get('https://api.twitch.tv/helix/channels', {
                params: {broadcaster_id: config.BROADCASTER_ID},
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
                }
            });
        });
        const title = res.data?.data?.[0]?.title || '';
        return title.includes('Aetherkey: @');
    } catch (err) {
        Logger.warn(`[SessionGates] Title check failed (${err.message}), keeping persisted gates`);
        return true;
    }
}

const restorers = [];

// Feature modules register what to rebuild on restore. Receives the persisted
// gates plus client/config so API-backed gates (e.g. MR pause state) can be re-applied.
function onRestoreGate(fn) {
    restorers.push(fn);
}

// Called from startBot after applyStartupStates. Reads the persisted gates and,
// if they belong to the current stream session (Aetherkey title marker), runs
// every restorer so the stream picks up exactly where it left off.
async function restoreGates(client, config) {
    const gates = readGates();

    if (!hasAnyGate(gates)) {
        Logger.log('[SessionGates] No gates persisted, skipping restore');
        return;
    }

    if (!(await streamSessionActive(config))) {
        Logger.log('[SessionGates] Stream title has no Aetherkey marker, clearing stale gates');
        clearPersistedGates();
        return;
    }

    Logger.log(`[SessionGates] Restoring persisted gates: ${JSON.stringify(gates)}`);
    for (const fn of restorers) {
        try {
            await fn(gates, client, config);
        } catch (err) {
            Logger.error(`[SessionGates] Restore callback failed: ${err.message}`);
        }
    }
}

function startSessionGates(client, config) {
    // A genuine Twitch stream end clears the persisted gates so the next stream starts fresh.
    onOffline(() => {
        clearPersistedGates();
    });
}

module.exports = {setGate, clearPersistedGates, onRestoreGate, restoreGates, startSessionGates};
// modules/song_requests/limusic.js
const axios = require('axios');
const WebSocket = require('ws');
const {config} = require('../../config');
const {Logger} = require('../../services');

// Limusic is authoritative for queue order and placement, so the bot no
// longer keeps a shadow queue or tries to move rows into position. Song swaps
// come from the Control API WebSocket instead of a 5s HTTP poll.

const READ_TIMEOUT_MS = 10_000; // milliseconds
const ADD_TIMEOUT_MS = 15_000; // resolver has a 12s ceiling of its own
const SKIP_TIMEOUT_MS = 25_000; // docs ask for at least 20s on next
const WS_HANDSHAKE_TIMEOUT_MS = 5_000; // milliseconds
const WS_RECONNECT_BASE_MS = 5_000; // milliseconds
const WS_RECONNECT_MAX_MS = 60_000; // milliseconds

let ssrSocket = null;
let reconnectTimer = null;
let listenerClient = null;
let listenerChannel = null;
let listenerStopped = true;
let listenerDownLogged = false;
let reconnectDelayMs = WS_RECONNECT_BASE_MS;
let lastAnnouncedVideoId = null;
let listenerInitialized = false;
let lastKnownPlaying = null;

//-------------------HELPERS-------------------
function getBaseUrl() {
    return String(config.LIMUSIC_CONTROL_URL || 'http://127.0.0.1:27199').replace(/\/+$/, '');
}

function getWebSocketUrl() {
    return `${getBaseUrl().replace(/^http/, 'ws')}/api/v1/ws`;
}

function createError(code, status, message, data = {}, originalCode = null) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    err.data = data;
    err.originalCode = originalCode;
    return err;
}

function buildHeaders(hasBody) {
    if (!config.LIMUSIC_CONTROL_TOKEN) {
        throw createError('missing_token', 0, 'LIMUSIC_CONTROL_TOKEN is not set');
    }
    const headers = {Authorization: `Bearer ${config.LIMUSIC_CONTROL_TOKEN}`};
    if (hasBody) headers['Content-Type'] = 'application/json';
    return headers;
}

function formatDurationSeconds(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function trackArtist(track) {
    return track?.artists || track?.artist_list?.[0] || 'Unknown';
}

function requesterSuffix(track) {
    return track?.queued_by ? ` (req. by ${track.queued_by})` : '';
}

function formatTrackLine(track, prefix = '') {
    const title = track?.title || 'Unknown';
    const artist = trackArtist(track);
    const duration = track?.duration || '?';
    return `${prefix}${title} - ${artist} [${duration}]${requesterSuffix(track)}`;
}

//-------------------API-------------------
async function apiRequest(method, path, {
    body,
    timeoutMs = READ_TIMEOUT_MS,
    retryBusy = true,
    attempt = 0
} = {}) {
    let headers;
    try {
        headers = buildHeaders(body !== undefined);
    } catch (err) {
        Logger.error(`[Limusic] ${err.message}`);
        throw err;
    }

    const url = `${getBaseUrl()}${path}`;
    if (config.DEBUG) {
        Logger.log(`[Limusic] ${method} ${path}${body !== undefined ? ` ${JSON.stringify(body)}` : ''}`);
    }

    try {
        const res = await axios({
            method,
            url,
            headers,
            data: body,
            timeout: timeoutMs
        });
        return res.data;
    } catch (err) {
        const status = err.response?.status || 0;
        const data = err.response?.data || {};
        const code = data.error || (status ? 'http_error' : 'network');
        const message = data.message || err.message || 'Limusic request failed';

        if (code === 'busy' && retryBusy && attempt < 1) {
            const retryAfter = Math.min(30, Math.max(1, Number(err.response?.headers?.['retry-after']) || 10));
            Logger.warn(`[Limusic] Control API busy, retrying after ${retryAfter}s`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return apiRequest(method, path, {
                body,
                timeoutMs,
                retryBusy,
                attempt: attempt + 1
            });
        }

        Logger.error(`[Limusic] ${method} ${path} failed: ${status} ${code} ${message}`);
        throw createError(code, status, message, data, err.code);
    }
}

//-------------------SONG REQUESTS-------------------
async function getCurrentSong() {
    const data = await apiRequest('GET', '/api/v1/now-playing');
    const track = data?.now;
    if (!track?.title) return null;
    return {
        title: track.title,
        artist: trackArtist(track),
        videoId: track.video_id
    };
}

async function getQueueWithCurrent(limit = 5) {
    const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 25);
    const data = await apiRequest('GET', `/api/v1/queue?from=current&limit=${safeLimit + 1}`);
    const items = data?.items || [];
    if (items.length === 0) return 'Queue is empty.';

    const current = items[0];
    const lines = [`🎶 CURRENT: ${formatTrackLine(current)} 🎶`];
    items.slice(1, safeLimit + 1).forEach((track, i) => {
        lines.push(`${i + 1}. ${formatTrackLine(track)}`);
    });
    return lines.join(' | ');
}

async function addSongToSSRQueue(input, requester) {
    const data = await apiRequest('POST', '/api/v1/queue/request', {
        body: {
            input,
            requested_by: requester,
            max_duration_sec: config.SSR_MAX_DURATION_SECONDS,
            allow_duplicates: false,
            play_next: true,
            allow_unknown_duration: false,
            reject_explicit: false
        },
        timeoutMs: ADD_TIMEOUT_MS
    });

    return {
        videoId: data?.item?.video_id || null,
        title: data?.item?.title || input,
        position: Number.isFinite(data?.position) ? data.position : null
    };
}

async function skipSong() {
    try {
        return await apiRequest('POST', '/api/v1/playback/next', {
            timeoutMs: SKIP_TIMEOUT_MS
        });
    } catch (err) {
        // A timed out skip may still have landed. Read state before reporting
        // failure so chat does not claim the wrong thing.
        if (err.code !== 'next_timeout' && err.originalCode !== 'ECONNABORTED') throw err;
        Logger.warn('[Limusic] Skip timed out, re-reading playback state');
        try {
            await apiRequest('GET', '/api/v1/status');
            return {ok: true, uncertain: true};
        } catch (statusErr) {
            throw err;
        }
    }
}

async function clearQueuedSongs() {
    return await apiRequest('POST', '/api/v1/queue/clear-queued');
}

// Playback endpoints are idempotent, but checking state first avoids fighting
// a change that raced the chat command. The live socket carries state already,
// so HTTP status is only needed when the listener is not connected.
async function getPausedState() {
    if (ssrSocket?.readyState === WebSocket.OPEN && typeof lastKnownPlaying === 'boolean') {
        return !lastKnownPlaying;
    }
    const status = await apiRequest('GET', '/api/v1/status');
    return Boolean(status?.paused);
}

async function setPlayback(targetPlaying) {
    const paused = await getPausedState();
    const needsChange = targetPlaying ? paused : !paused;
    if (!needsChange) {
        return {changed: false, playing: targetPlaying};
    }
    const path = targetPlaying ? '/api/v1/playback/play' : '/api/v1/playback/pause';
    const result = await apiRequest('POST', path);
    const playing = typeof result?.playing === 'boolean' ? result.playing : targetPlaying;
    lastKnownPlaying = playing;
    return {changed: true, playing};
}

async function resumePlayback() {
    return await setPlayback(true);
}

async function pausePlayback() {
    return await setPlayback(false);
}

//-------------------SSR LISTENER-------------------
function markListenerUp() {
    reconnectDelayMs = WS_RECONNECT_BASE_MS;
    if (listenerDownLogged) {
        Logger.log('[Limusic] SSR listener reconnected');
        listenerDownLogged = false;
    }
    if (config.DEBUG) Logger.log('[Limusic] SSR listener connected');
}

function handleSnapshotFrame(frame) {
    lastAnnouncedVideoId = frame?.current?.video_id || null;
    if (typeof frame?.playing === 'boolean') lastKnownPlaying = frame.playing;
}

function announceNowPlaying(frame) {
    const track = frame?.current;
    const videoId = track?.video_id;
    if (!videoId) return;

    if (!listenerInitialized) {
        listenerInitialized = true;
        lastAnnouncedVideoId = videoId;
        return;
    }
    if (videoId === lastAnnouncedVideoId) return;
    lastAnnouncedVideoId = videoId;
    if (!track.queued_by) return;

    const title = track.title || 'Unknown';
    listenerClient.say(listenerChannel, `🎶 Now playing SR request from ${track.queued_by}: ${title} ✧`);
}

function handleWsMessage(raw) {
    let frame;
    try {
        frame = JSON.parse(raw.toString());
    } catch (err) {
        return;
    }

    if (frame.type === 'hello' || frame.type === 'resync') {
        listenerInitialized = true;
        handleSnapshotFrame(frame);
        return;
    }
    if (frame.type === 'playback_state') {
        if (typeof frame.playing === 'boolean') lastKnownPlaying = frame.playing;
        return;
    }
    if (frame.type === 'now_playing') announceNowPlaying(frame);
}

function scheduleReconnect() {
    if (listenerStopped || reconnectTimer) return;
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(WS_RECONNECT_MAX_MS, reconnectDelayMs * 2);
    if (!listenerDownLogged) {
        Logger.warn(`[Limusic] SSR listener offline, retrying with backoff up to ${WS_RECONNECT_MAX_MS / 1000}s`);
        listenerDownLogged = true;
    }
    if (config.DEBUG) Logger.log(`[Limusic] SSR listener retry in ${delay / 1000}s`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openListenerSocket();
    }, delay);
    reconnectTimer.unref?.();
}

function openListenerSocket() {
    if (listenerStopped || ssrSocket) return;

    let url;
    let headers;
    try {
        url = getWebSocketUrl();
        headers = buildHeaders(false);
    } catch (err) {
        Logger.error(`[Limusic] ${err.message}`);
        return;
    }

    let socket;
    try {
        socket = new WebSocket(url, {headers, handshakeTimeout: WS_HANDSHAKE_TIMEOUT_MS});
    } catch (err) {
        Logger.error(`[Limusic] SSR listener failed to start: ${err.message}`);
        scheduleReconnect();
        return;
    }
    ssrSocket = socket;

    socket.on('open', markListenerUp);
    socket.on('message', handleWsMessage);
    socket.on('error', err => {
        if (config.DEBUG) Logger.warn(`[Limusic] SSR listener error: ${err.message}`);
    });
    socket.on('unexpected-response', (request, response) => {
        Logger.warn(`[Limusic] SSR listener rejected: ${response.statusCode}`);
        response.resume();
        socket.terminate();
        scheduleReconnect();
    });
    socket.on('close', (code, reason) => {
        if (ssrSocket === socket) ssrSocket = null;
        lastKnownPlaying = null;
        if (listenerStopped) return;
        const text = reason?.toString();
        if (text && !listenerDownLogged) {
            Logger.warn(`[Limusic] SSR listener closed: ${text}`);
            listenerDownLogged = true;
        }
        scheduleReconnect();
    });
}

function startSSRListener(client, channel) {
    if (!listenerStopped && (ssrSocket || reconnectTimer)) return;
    listenerStopped = false;
    listenerClient = client;
    listenerChannel = channel.startsWith('#') ? channel : `#${channel}`;
    reconnectDelayMs = WS_RECONNECT_BASE_MS;
    openListenerSocket();
}

function stopSSRListener() {
    listenerStopped = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ssrSocket) {
        const socket = ssrSocket;
        ssrSocket = null;
        socket.terminate();
    }
    lastAnnouncedVideoId = null;
    listenerInitialized = false;
    lastKnownPlaying = null;
    listenerDownLogged = false;
    Logger.log('[Limusic] SSR listener stopped');
}

module.exports = {
    getCurrentSong,
    getQueueWithCurrent,
    addSongToSSRQueue,
    skipSong,
    clearQueuedSongs,
    resumePlayback,
    pausePlayback,
    formatDurationSeconds,
    startSSRListener,
    stopSSRListener
};

// modules/song_requests/pear-desktop-music.js
const {config} = require('../../config');
const {initPearToken} = require('../../auth');
const axios = require('axios');
const {Logger} = require('../../services');
const {pushToQueue, shiftQueue, getQueue, saveQueue} = require('./ssr-queue');

let ssrPollInterval = null;

// ---------- Helper ----------
function getBaseUrl() {
    return config.getPearBaseUrl();
}

// Queue items are either a direct video renderer or a wrapper around one or more
// alternate versions, so every queue read has to unwrap before looking at fields.
function getQueueRenderer(item) {
    return item?.playlistPanelVideoRenderer ||
        item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ||
        null;
}

function getQueueVideoId(item) {
    return getQueueRenderer(item)?.videoId || null;
}

function getQueueVideoIds(items) {
    return items.map(item => getQueueVideoId(item));
}

function findCurrentIndex(items) {
    return items.findIndex(item => getQueueRenderer(item)?.selected === true);
}

// All reads and writes of ssr_queue.json go through one chain. Two viewers can
// request at the same instant, and the 5s poll can run during an insert; without
// this both would work from the same snapshot and place songs out of order.
let ssrQueueLock = Promise.resolve();

function withSsrQueueLock(task) {
    const run = ssrQueueLock.then(task);
    ssrQueueLock = run.catch(() => {});
    return run;
}

async function apiGet(endpoint) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initPearToken();
        if (!config.PEAR_ACCESS_TOKEN) {
            Logger.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) Logger.log(`[DEBUG] Requesting Pear API: ${url}`);
    try {
        const res = await axios.get(url, {
            headers: {'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}`}
        });
        return res.data;
    } catch (err) {
        if (err.response?.status === 401) {
            config.PEAR_ACCESS_TOKEN = null;  // force re-auth on next call
        }
        Logger.error(`[ERROR] API GET ${endpoint} failed: ${err.response?.status} ${err.response?.data || err.message}`);
        return null;
    }
}

async function apiPost(endpoint, body = {}) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initPearToken();
        if (!config.PEAR_ACCESS_TOKEN) {
            Logger.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) Logger.log(`[DEBUG] Posting Pear API: ${url} ${body}`);
    try {
        const res = await axios.post(url, body, {
            headers: {'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}`}
        });
        return res.data;
    } catch (err) {
        if (err.response?.status === 401) {
            config.PEAR_ACCESS_TOKEN = null;  // force re-auth on next call
        }
        Logger.error(`[ERROR] API POST ${endpoint} failed: ${err.response?.status} ${err.response?.data || err.message}`);
        return null;
    }
}

async function apiPatch(endpoint, body = {}) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initPearToken();
        if (!config.PEAR_ACCESS_TOKEN) {
            Logger.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) Logger.log(`[DEBUG] Patching Pear API: ${url} ${body}`);
    try {
        const res = await axios.patch(url, body, {
            headers: {'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}`}
        });
        return res.data;
    } catch (err) {
        if (err.response?.status === 401) {
            config.PEAR_ACCESS_TOKEN = null;  // force re-auth on next call
        }
        Logger.error(`[ERROR] API PATCH ${endpoint} failed: ${err.response?.status} ${err.response?.data || err.message}`);
        return null;
    }
}

// ---------- YouTube ----------
function parseDuration(iso) {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return {hours, minutes, seconds, totalSeconds: hours * 3600 + minutes * 60 + seconds};
}

function formatDuration({hours, minutes, seconds}) {
    const m = hours ? hours * 60 + minutes : minutes;
    return `${String(m).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function getSongByVideoId(videoId) {
    try {
        const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'snippet,contentDetails',
                id: videoId,
                key: config.YOUTUBE_ACCESS_KEY
            }
        });
        const item = res.data.items?.[0];
        if (!item) return null;

        const duration = parseDuration(item.contentDetails.duration);
        if (duration.totalSeconds > 10 * 60) {
            return {tooLong: true, durationText: formatDuration(duration)};
        }

        return {
            videoId,
            title: item.snippet.title,
        };
    } catch (err) {
        Logger.error(`[ERROR] YouTube video lookup failed: ${err.message}`);
        return null;
    }
}

async function searchSong(query) {
    try {
        const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q: query,
                type: 'video',
                videoCategoryId: '10',
                maxResults: 1,
                key: config.YOUTUBE_ACCESS_KEY
            }
        });
        const item = res.data.items?.[0];
        if (!item) return null;

        return await getSongByVideoId(item.id.videoId);
    } catch (err) {
        Logger.error(`[ERROR] YouTube search failed: ${err.message}`);
        return null;
    }
}

// ---------- Functions ----------
async function getCurrentSong() {
    const data = await apiGet('/song');
    if (!data || !data.title || !data.artist || !data.songDuration) return null;
    return {
        title: data.title,
        artist: data.artist,
        videoId: data.videoId
    };
}

async function waitIfSongEnding() {
    const data = await apiGet('/song');
    if (!data) return;

    const remaining = data.songDuration - data.elapsedSeconds;
    if (remaining > 10) return;

    Logger.log(`[SSR] Song ending in ${remaining}s, waiting for next song...`);

    const currentVideoId = data.videoId;
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const next = await apiGet('/song');
        if (next?.videoId !== currentVideoId) {
            Logger.log(`[SSR] Song changed, proceeding...`);

            // sync SSR queue before proceeding
            const ssrQueue = getQueue();
            if (ssrQueue.length > 0 && ssrQueue[0].videoId === currentVideoId) {
                Logger.log(`[SSR] Shifting completed song from SSR queue before insert`);
                shiftQueue();
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
        }
    }
}

// Pear's insert lands directly after the current song when it can find the
// playing item, but falls back to the end of the queue. Diffing the queue
// snapshots finds the real landing index instead of assuming current + 1.
function findInsertedIndex(beforeIds, afterItems, videoId) {
    const afterIds = getQueueVideoIds(afterItems);
    const beforeCount = beforeIds.filter(id => id === videoId).length;
    const afterCount = afterIds.filter(id => id === videoId).length;
    if (afterCount <= beforeCount) return -1;

    if (afterIds.length === beforeIds.length + 1) {
        let prefix = 0;
        while (prefix < beforeIds.length && beforeIds[prefix] === afterIds[prefix]) prefix++;

        let suffix = 0;
        while (
            suffix < beforeIds.length - prefix &&
            beforeIds[beforeIds.length - 1 - suffix] === afterIds[afterIds.length - 1 - suffix]
        ) suffix++;

        if (prefix + suffix >= beforeIds.length) return prefix;
    }

    // The queue window moved between the two reads, so the rows no longer line
    // up. Find the extra occurrence, checking from the end because Pear appends
    // when it cannot locate the currently playing item.
    const positions = [];
    afterIds.forEach((id, i) => {
        if (id === videoId) positions.push(i);
    });
    for (let k = positions.length - 1; k >= 0; k--) {
        if (beforeIds[positions[k]] !== videoId) return positions[k];
    }
    return positions[positions.length - 1];
}

async function insertSongIntoQueue(videoId, title, requester) {
    // 0. wait if the current song is about to end, so the snapshots are stable
    await waitIfSongEnding();

    // 1. snapshot the queue and the request list before inserting
    const beforeItems = (await apiGet('/queue'))?.items || [];
    const beforeIds = getQueueVideoIds(beforeItems);
    const pendingEntries = getQueue();

    // 2. insert near the current song; the exact position gets corrected below
    const posted = await apiPost('/queue', {videoId, insertPosition: 'INSERT_AFTER_CURRENT_VIDEO'});
    if (posted === null) {
        Logger.error(`[SSR] Failed to add "${title}" to the Pear queue`);
        return;
    }

    // 3. Pear queues the add asynchronously, so poll briefly until the row
    // shows up instead of assuming a fixed delay is long enough
    let afterItems = [];
    let currentIndex = -1;
    let newIndex = -1;
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        afterItems = (await apiGet('/queue'))?.items || [];
        currentIndex = findCurrentIndex(afterItems);
        newIndex = findInsertedIndex(beforeIds, afterItems, videoId);
        if (newIndex >= 0) break;
    }

    if (currentIndex < 0 || newIndex < 0) {
        // Placement cannot be verified, but the song is in Pear's queue, so keep
        // it tracked and let the poll announce it whenever it comes up.
        Logger.warn(`[SSR] Could not verify placement for "${title}", leaving it where Pear put it`);
        pushToQueue({videoId, title, requester});
        return;
    }

    // 4. find the last earlier request that is still ahead of the current song.
    // Played, skipped and cleared entries simply do not match. The new song's
    // own row is skipped so a repeated request cannot anchor to itself.
    const pendingIds = new Set(pendingEntries.map(entry => entry.videoId));
    let anchorIndex = -1;
    afterItems.forEach((item, i) => {
        if (i <= currentIndex || i === newIndex) return;
        const id = getQueueVideoId(item);
        if (id && pendingIds.has(id)) anchorIndex = i;
    });

    // 5. move the new song directly behind that anchor, or directly behind the
    // current song when no earlier request is still pending. MOVE_ITEM removes
    // fromIndex first, so when the song sits after the anchor the slot after it
    // is where the anchor lands, and when the song sits before the anchor the
    // anchor slot itself is correct.
    const anchor = anchorIndex >= 0 ? anchorIndex : currentIndex;
    const moveTo = newIndex > anchor ? anchor + 1 : anchor;
    let finalIndex = moveTo;

    if (moveTo !== newIndex) {
        const patched = await apiPatch(`/queue/${newIndex}`, {toIndex: moveTo});
        if (patched === null) {
            Logger.error(`[SSR] Failed to move "${title}" into request order`);
            finalIndex = newIndex;
        }
    }

    // 6. track the request only after it is placed, so a failed insert does not
    // leave a phantom entry that later placements anchor against
    pushToQueue({videoId, title, requester});

    Logger.log(`[SSR DEBUG] currentIndex: ${currentIndex}, newIndex: ${newIndex}, anchorIndex: ${anchorIndex}, moveTo: ${moveTo}, pending: ${pendingEntries.length}`);
    Logger.log(`[SSR] ${requester} queued "${title}" at queue index ${finalIndex}`);
}

function addSongToSSRQueue(videoId, title, requester) {
    return withSsrQueueLock(() => insertSongIntoQueue(videoId, title, requester));
}

async function getQueueWithCurrent(limit = 5) {
    const queueData = await apiGet('/queue');
    const queueItems = queueData?.items || [];
    const ssrQueue = getQueue();

    // use the queue snapshot's current row as the source of truth, with the
    // direct /song endpoint only as a fallback when the queue has no selection
    const currentIndex = findCurrentIndex(queueItems);
    const currentSongItem = currentIndex >= 0 ? queueItems[currentIndex] : null;
    const upcomingQueue = currentIndex >= 0
        ? queueItems.slice(currentIndex + 1, currentIndex + 1 + limit)
        : queueItems.slice(0, limit);

    const lines = [];

    if (currentSongItem) {
        const renderer = getQueueRenderer(currentSongItem);
        const title = renderer?.title?.runs?.[0]?.text || 'Unknown';
        const artist = renderer?.shortBylineText?.runs?.[0]?.text || 'Unknown';
        const length = renderer?.lengthText?.runs?.[0]?.text || '?';
        const currentVideoId = renderer?.videoId;
        const ssrEntry = ssrQueue.find(s => s.videoId === currentVideoId);
        const suffix = ssrEntry ? ` (req. by ${ssrEntry.requester})` : '';
        lines.push(`🎶 CURRENT: ${title} - ${artist} [${length}]${suffix} 🎶`);
    } else {
        const current = await getCurrentSong();
        if (current) lines.push(`🎶 CURRENT: ${current.artist} - ${current.title} [?] 🎶`);
    }

    upcomingQueue.forEach((item, i) => {
        const renderer = getQueueRenderer(item);
        const title = renderer?.title?.runs?.[0]?.text || 'Unknown';
        const artist = renderer?.shortBylineText?.runs?.[0]?.text || 'Unknown';
        const length = renderer?.lengthText?.runs?.[0]?.text || '?';
        const videoId = renderer?.videoId;
        const ssrEntry = ssrQueue.find(s => s.videoId === videoId);
        const suffix = ssrEntry ? ` (req. by ${ssrEntry.requester})` : '';
        lines.push(`${i + 1}. ${title} - ${artist} [${length}]${suffix}`);
    });

    if (lines.length === 0) return 'Queue is empty.';
    return lines.join(' | ');
}

async function skipSong() {
    return await apiPost('/next', {});
}

// ---------- SSR Polling ----------
let lastPolledVideoId = null;

// Pear's queue is authoritative. Requests can be skipped, cleared or reordered
// outside the bot, so each poll drops entries that are no longer ahead of the
// current song and detects the playing request anywhere in the list, not just
// at the head.
async function reconcileSsrQueue(client, channel) {
    const ssrQueue = getQueue();
    if (ssrQueue.length === 0) return;

    const queueData = await apiGet('/queue');
    const queueItems = queueData?.items || [];
    if (queueItems.length === 0) return;

    const currentIndex = findCurrentIndex(queueItems);
    if (currentIndex < 0) return;

    const currentVideoId = getQueueVideoId(queueItems[currentIndex]);
    if (!currentVideoId || currentVideoId === lastPolledVideoId) return;
    lastPolledVideoId = currentVideoId;

    const aheadIds = new Set();
    for (let i = currentIndex + 1; i < queueItems.length; i++) {
        const id = getQueueVideoId(queueItems[i]);
        if (id) aheadIds.add(id);
    }

    const playedIndex = ssrQueue.findIndex(entry => entry.videoId === currentVideoId);
    const played = playedIndex >= 0 ? ssrQueue[playedIndex] : null;

    // Everything before the playing request is done, and anything not still
    // ahead of it was skipped or cleared in Pear. Filter both cases the same way
    // so stale entries cannot linger behind the current song.
    const candidates = playedIndex >= 0 ? ssrQueue.slice(playedIndex + 1) : ssrQueue;
    const remaining = candidates.filter(entry => aheadIds.has(entry.videoId));

    if (remaining.length !== ssrQueue.length) saveQueue(remaining);

    if (!played) return;

    Logger.log(`[SSR] "${played.title}" by ${played.requester} is now playing, removed from SSR queue`);
    const next = remaining[0];
    if (next) {
        client.say(channel, `🎶 Now playing SR request from ${played.requester}: ${played.title} ✧ Up next: ${next.title} (requested by ${next.requester})`);
    } else {
        client.say(channel, `🎶 Now playing SR request from ${played.requester}: ${played.title} ✧`);
    }
}

function startSSRPolling(client, channel) {
    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    ssrPollInterval = setInterval(async () => {
        try {
            await withSsrQueueLock(() => reconcileSsrQueue(client, formattedChannel));
        } catch (err) {
            Logger.error(`[ERROR] SSR polling failed: ${err.message}`);
        }
    }, 5000);
}

function stopSSRPolling() {
    if (ssrPollInterval) {
        clearInterval(ssrPollInterval);
        ssrPollInterval = null;
    }
    lastPolledVideoId = null;
    Logger.log('[SSR] Polling stopped');
}

module.exports = {
    getCurrentSong,
    getQueueWithCurrent,
    searchSong,
    getSongByVideoId,
    addSongToSSRQueue,
    startSSRPolling,
    stopSSRPolling,
    skipSong
};

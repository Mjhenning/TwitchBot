// modules/pear-desktop-music.js
const { config, initTokens } = require('../config');
const axios = require('axios');
const { pushToQueue, shiftQueue, getQueue, getQueueLength } = require('./ssr-queue');

// ---------- Helper ----------
function getBaseUrl() {
    return config.getPearBaseUrl();
}

async function apiGet(endpoint) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initTokens();
        if (!config.PEAR_ACCESS_TOKEN) {
            console.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) console.log('[DEBUG] Requesting Pear API:', url);
    try {
        const res = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}` }
        });
        return res.data;
    } catch (err) {
        console.error(`[ERROR] API GET ${endpoint} failed:`, err.response?.status, err.response?.data || err.message);
        return null;
    }
}

async function apiPost(endpoint, body = {}) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initTokens();
        if (!config.PEAR_ACCESS_TOKEN) {
            console.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) console.log('[DEBUG] Posting Pear API:', url, body);
    try {
        const res = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}` }
        });
        return res.data;
    } catch (err) {
        console.error(`[ERROR] API POST ${endpoint} failed:`, err.response?.status, err.response?.data || err.message);
        return null;
    }
}

async function apiPatch(endpoint, body = {}) {
    if (!config.PEAR_ACCESS_TOKEN) {
        await initTokens();
        if (!config.PEAR_ACCESS_TOKEN) {
            console.error('[ERROR] No Pear access token available');
            return null;
        }
    }
    const url = `${getBaseUrl()}${endpoint}`;
    if (config.DEBUG) console.log('[DEBUG] Patching Pear API:', url, body);
    try {
        const res = await axios.patch(url, body, {
            headers: { 'Authorization': `Bearer ${config.PEAR_ACCESS_TOKEN}` }
        });
        return res.data;
    } catch (err) {
        console.error(`[ERROR] API PATCH ${endpoint} failed:`, err.response?.status, err.response?.data || err.message);
        return null;
    }
}

// ---------- YouTube ----------
function parseDuration(iso) {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return { hours, minutes, seconds, totalSeconds: hours * 3600 + minutes * 60 + seconds };
}

function formatDuration({ hours, minutes, seconds }) {
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
            return { tooLong: true, durationText: formatDuration(duration) };
        }

        return {
            videoId,
            title: item.snippet.title,
        };
    } catch (err) {
        console.error('[ERROR] YouTube video lookup failed:', err.message);
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
        console.error('[ERROR] YouTube search failed:', err.message);
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

    console.log(`[SSR] Song ending in ${remaining}s, waiting for next song...`);

    const currentVideoId = data.videoId;
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const next = await apiGet('/song');
        if (next?.videoId !== currentVideoId) {
            console.log(`[SSR] Song changed, proceeding...`);

            // sync SSR queue before proceeding
            const ssrQueue = getQueue();
            if (ssrQueue.length > 0 && ssrQueue[0].videoId === currentVideoId) {
                console.log(`[SSR] Shifting completed song from SSR queue before insert`);
                shiftQueue();
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
        }
    }
}

async function addSongToSSRQueue(videoId, title, requester) {
    // 0. wait if current song is about to end
    await waitIfSongEnding();

    // 1. insert right after current — always lands at currentIndex + 1
    await apiPost('/queue', { videoId, insertPosition: 'INSERT_AFTER_CURRENT_VIDEO' });

    // 2. wait briefly for Pear to register
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. push to SSR queue
    pushToQueue({ videoId, title, requester });
    const ssrLength = getQueueLength();
    const arrayPosition = ssrLength - 1;

    // 4. fetch queue to get current index
    const queueData = await apiGet('/queue');
    const queueItems = queueData?.items || [];
    const currentIndex = queueItems.findIndex(item => item.playlistPanelVideoRenderer?.selected);

    // song always lands at currentIndex + 1 after INSERT_AFTER_CURRENT_VIDEO
    const songIndex = currentIndex + 1;
    const targetIndex = currentIndex + arrayPosition + 1;

    console.log(`[SSR DEBUG] currentIndex: ${currentIndex}, songIndex: ${songIndex}, targetIndex: ${targetIndex}, arrayPosition: ${arrayPosition}`);

    // 5. only patch if it needs to move (i.e. more than one SSR song queued)
    if (songIndex !== targetIndex) {
        await apiPatch(`/queue/${songIndex}`, { toIndex: targetIndex });
    }

    console.log(`[SSR] ${requester} queued "${title}" at position ${targetIndex}`);
}

async function getQueueWithCurrent(limit = 5) {
    const queueData = await apiGet('/queue');
    const queueItems = queueData?.items || [];
    const ssrQueue = getQueue();

    const currentIndex = queueItems.findIndex(item => item.playlistPanelVideoRenderer?.selected);
    const currentSongItem = currentIndex >= 0 ? queueItems[currentIndex] : null;
    const upcomingQueue = currentIndex >= 0
        ? queueItems.slice(currentIndex + 1, currentIndex + 1 + limit)
        : queueItems.slice(0, limit);

    const lines = [];

    if (currentSongItem) {
        const renderer = currentSongItem.playlistPanelVideoRenderer;
        const title = renderer?.title?.runs?.[0]?.text || 'Unknown';
        const artist = renderer?.shortBylineText?.runs?.[0]?.text || 'Unknown';
        const length = renderer?.lengthText?.runs?.[0]?.text || '?';
        const currentVideoId = renderer?.videoId;
        const ssrEntry = ssrQueue.find(s => s.videoId === currentVideoId);
        const suffix = ssrEntry ? ` (req. by ${ssrEntry.requester})` : '';
        lines.push(`🎶 CURRENT: ${title} - ${artist} [${length}]${suffix} 🎶`);
    } else {
        const current = await getCurrentSong();
        if (current) lines.push(`🎶 CURRENT: ${current.artist} - ${current.title} [${current.length || '?'}] 🎶`);
    }

    upcomingQueue.forEach((item, i) => {
        const renderer = item.playlistPanelVideoRenderer;
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

function startSSRPolling(client, channel) {
    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    setInterval(async () => {
        try {
            const ssrQueue = getQueue();
            if (ssrQueue.length === 0) return;

            const data = await apiGet('/song');
            if (!data?.videoId) return;

            const currentVideoId = data.videoId;

            // song changed since last poll
            if (currentVideoId === lastPolledVideoId) return;
            lastPolledVideoId = currentVideoId;

            // check if the now-playing song is the head of our SSR queue
            if (currentVideoId === ssrQueue[0].videoId) {
                const played = shiftQueue();
                console.log(`[SSR] "${played.title}" by ${played.requester} is now playing, removed from SSR queue`);

                const next = getQueue();
                if (next.length > 0) {
                    client.say(channel, `🎶 Now playing SSR request from ${played.requester}: ${played.title} ✧ Up next: ${next[0].title} (requested by ${next[0].requester})`);
                } else {
                    client.say(channel, `🎶 Now playing SSR request from ${played.requester}: ${played.title} ✧`);
                }
            }
        } catch (err) {
            console.error('[ERROR] SSR polling failed:', err.message);
        }
    }, 5000);
}

module.exports = { getCurrentSong, getQueueWithCurrent, searchSong, getSongByVideoId, addSongToSSRQueue, startSSRPolling, skipSong };
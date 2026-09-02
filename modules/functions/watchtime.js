// modules/functions/watchtime.js
// Persists per-user accumulated watch time. Viewers are tracked in memory
// while active (they typed recently), and their accrued minutes are flushed
// to data/watchtime.json so totals survive bot restarts.
const fs = require('fs');
const path = require('path');
const {config} = require('../../config');
const {Logger} = require('../../services');

//-------------------STATE-------------------
const WATCH_FILE = path.join(__dirname, '../../data/watchtime.json');
const FLUSH_INTERVAL_MS = 60 * 1000; // flush accrued time every minute

let store = {}; // userId -> seconds
let active = new Map(); // userId -> { name, lastTick, accrued }
let flushTimer = null;

//--------------------LOAD--------------------
function loadWatchtime() {
    try {
        store = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')) || {};
    } catch {
        Logger.warn('[Watchtime] Creating new watchtime database');
        store = {};
    }
}

function saveWatchtime() {
    try {
        fs.writeFileSync(WATCH_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[Watchtime] Failed to save watchtime.json: ${err.message}`);
    }
}

//------------------TRACKING------------------
// Called on every chat message from a viewer. Bumps their active session and
// banks the time that elapsed since their previous marker.
function markActive(userId, userName) {
    const now = Date.now();
    const session = active.get(userId);

    if (session) {
        session.accrued += (now - session.lastTick) / 1000;
        session.lastTick = now;
        if (userName && session.name !== userName) session.name = userName;
    } else {
        active.set(userId, {name: userName || 'unknown', lastTick: now, accrued: 0});
    }
}

// Called on a periodic timer; banks elapsed time for everyone still active so
// a quiet lurker who happened to talk earlier still gets credited.
function flushActive(force = false) {
    const now = Date.now();
    active.forEach((session, userId) => {
        if (force) {
            session.accrued += (now - session.lastTick) / 1000;
        }
        store[userId] = (store[userId] || 0) + Math.round(session.accrued);
        session.accrued = 0;
        session.lastTick = now;
    });
    saveWatchtime();
}

// Banks and clears everyone. Used on bot stop so nothing is lost mid-stream.
function stopTracking() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    flushActive(true);
    active.clear();
}

//--------------------LOOKUP--------------------
function getWatchtime(userId) {
    // include unflushed active time so a just-typed user sees an up to date total
    const banked = store[userId] || 0;
    const session = active.get(userId);
    const live = session ? session.accrued : 0;
    return Math.floor(banked + live);
}

function getWatchtimeFormatted(seconds) {
    const totalMin = Math.floor(seconds / 60);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

function startFlush() {
    if (flushTimer) return;
    flushTimer = setInterval(() => flushActive(), FLUSH_INTERVAL_MS);
    // don't hold the process open
    if (flushTimer.unref) flushTimer.unref();
}

//--------------------INIT--------------------
function initWatchtime() {
    loadWatchtime();
    startFlush();
}

module.exports = {
    initWatchtime,
    markActive,
    getWatchtime,
    getWatchtimeFormatted,
    flushActive,
    stopTracking,
    stopWatchtime: stopTracking
};

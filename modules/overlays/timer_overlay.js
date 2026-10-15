// modules/overlays/timer_overlay.js
// Bot-authoritative Glosso-thon state. Drives the "timer" channel of the overlay
// hub for the countdown and owns the shared Glosso-thon config other thon overlays
// read from (the per-overlay pins and the goals list). The bot owns the state (so a
// browser refresh, OBS blip, or bot restart never loses the clock) and pushes it to
// the source, which only renders. Gift subs extend the timer automatically via the
// EventSub handler.
//
// Chat control (all mod-only):
//   !thon          master switch: activate / deactivate the whole thon system
//   !timer         run / unrun (pause / unpause) the countdown
//   !timer pin     pin / unpin the timer overlay
//   !timer add|set manual time control
//   !goals         transient show (unpinned only) + chat summary
//   !goals pin     pin / unpin the goals overlay
//
// The "active" flag is the master switch: when off the overlays hide, the bot
// ignores timer/goals commands and gift subs, and the clock is parked.
const fs = require('fs');
const path = require('path');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {registerOverlay, broadcast} = require('./overlay_hub');

//---------------------TUNING---------------------
const START_MS = (config.TIMER_START_MINUTES || 60) * 60 * 1000; // base length when no saved state
const DEFAULT_GIFT_MINUTES = config.TIMER_GIFT_MINUTES || 6; // fallback minutes added per gifted sub
const GLOSSOTHON_FILE = config.GLOSSOTHON_FILE;

// Fallback goals so the file does not need seeding; edit data/glossothon.json to
// swap these out (each entry is a sub-count "unlock" with a reward description).
const DEFAULT_GOALS = [
    {at: 25, label: '7 Brand New Emotes'},
    {at: 50, label: 'Profile Picture + Banner update on Twitch'},
    {at: 100, label: 'Co-op Games With Mods Stream'},
    {at: 150, label: 'A New Model Variant'},
    {at: 200, label: 'Community Suggested Indie Game Stream'},
    {at: 250, label: 'Model 2.0'},
    {at: 300, label: 'Community Voted Horror Game'},
    {at: 400, label: 'Team Fortress 2 Gamble Stream (50 crate unbox)'},
    {at: 500, label: '24 Hour Stream'}
];

//---------------------STATE---------------------
let running = false;
let endAt = 0; // epoch ms the run ends, only meaningful while running
let remMs = START_MS; // remaining while paused
let subs = 0; // gifted subs counted this run
let active = false; // master switch: the whole thon system is off until switched on
let pins = {timer: true, goals: false}; // per-overlay persistent visibility
let giftMinutes = DEFAULT_GIFT_MINUTES; // minutes added per gifted sub (configurable in json)
let goalList = DEFAULT_GOALS.slice(); // [{at, label}], cheapest unlock first

//--------------------PERSIST--------------------
// The countdown, banked gift-sub count, pins and goals persist so a new stream
// picks up where the last one left off. The clock always comes back paused: it
// only ticks while the bot is up and a mod has toggled it on, so time never drains
// between streams or while the bot is offline.
function normalizeGoals(raw) {
    if (!Array.isArray(raw)) return DEFAULT_GOALS.slice();
    const cleaned = raw
        .map((g) => ({at: Number(g && g.at), label: String((g && g.label) || '').trim()}))
        .filter((g) => Number.isFinite(g.at) && g.at > 0 && g.label)
        .sort((a, b) => a.at - b.at);
    return cleaned.length ? cleaned : DEFAULT_GOALS.slice();
}

function load() {
    try {
        const data = JSON.parse(fs.readFileSync(GLOSSOTHON_FILE, 'utf8'));
        active = !!data.active;
        // migrate the old flat goalsPinned key into the pins map
        if (data.pins && typeof data.pins === 'object') {
            pins = {timer: data.pins.timer !== false, goals: !!data.pins.goals};
        } else {
            pins = {timer: true, goals: !!data.goalsPinned};
        }
        goalList = normalizeGoals(data.goals);
        giftMinutes = Number(data.giftMinutes) > 0 ? Number(data.giftMinutes) : DEFAULT_GIFT_MINUTES;
        subs = Number(data.subs) || 0;
        remMs = Number.isFinite(data.remMs) ? Math.max(0, data.remMs) : START_MS;
        running = false;
        endAt = 0;
        Logger.log(`[Timer] Restored ${Math.ceil(remMs / 60000)} min, ${subs} gift sub(s) @ ${giftMinutes} min/sub (${active ? 'active' : 'inactive'}, pins timer=${pins.timer} goals=${pins.goals}, ${goalList.length} goal(s))`);
    } catch {
        Logger.warn('[Timer] No saved timer state, starting fresh');
    }
}

function save() {
    try {
        fs.mkdirSync(path.dirname(GLOSSOTHON_FILE), {recursive: true});
        const tmp = GLOSSOTHON_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({active, pins, giftMinutes, remMs: remainingMs(), subs, goals: goalList, updatedAt: Date.now()}, null, 2), 'utf8');
        fs.renameSync(tmp, GLOSSOTHON_FILE);
    } catch (err) {
        Logger.error(`[Timer] Failed to save state: ${err.message}`);
    }
}

// While running the remainder only lives as endAt, so a periodic save keeps the
// persisted value close to the truth between mutations (crash resilience).
let heartbeat = null;
function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
        if (running) save();
    }, 15000);
    if (heartbeat.unref) heartbeat.unref();
}

//---------------------STATE MATH---------------------
function remainingMs() {
    return running ? Math.max(0, endAt - Date.now()) : remMs;
}

function snapshot() {
    const rem = remainingMs();
    return {
        type: 'timer',
        active,
        pins: {...pins},
        running,
        remainingMs: rem,
        subs,
        goals: goalList,
        done: !running && rem <= 0,
        giftMinutes
    };
}

//---------------------EMIT---------------------
// Other modules (e.g. the goals overlay) subscribe here so they re-render from
// the same Glosso-thon state without importing each other directly.
const stateListeners = new Set();

function onStateChange(fn) {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
}

function emit() {
    save();
    const snap = snapshot();
    broadcast('timer', snap);
    for (const fn of stateListeners) {
        try {
            fn(snap);
        } catch (err) {
            Logger.error(`[Timer] State listener failed: ${err.message}`);
        }
    }
}

function addMs(ms) {
    if (running) endAt += ms;
    else remMs += ms;
}

//---------------------MUTATORS---------------------
function pauseTimer() {
    if (running) {
        remMs = remainingMs();
        running = false;
        endAt = 0;
        emit();
    }
    return snapshot();
}

function resumeTimer() {
    if (!running && active && remMs > 0) {
        endAt = Date.now() + remMs;
        running = true;
        emit();
    }
    return snapshot();
}

function toggleTimer() {
    return running ? pauseTimer() : resumeTimer();
}

function addTimerMinutes(min) {
    if (min > 0) {
        addMs(min * 60 * 1000);
        emit();
    }
    return snapshot();
}

function setTimerMinutes(min) {
    if (min >= 0) {
        remMs = min * 60 * 1000;
        if (running) endAt = Date.now() + remMs;
        emit();
    }
    return snapshot();
}

//---------------------MASTER SWITCH---------------------
// active controls the whole thon system: the overlays hide, the clock parks and
// the bot stops answering timer/goals commands and gift subs while it is off.
function isActive() {
    return active;
}

function setActive(on) {
    active = !!on;
    if (!active && running) {
        remMs = remainingMs();
        running = false;
        endAt = 0;
    }
    emit();
    return snapshot();
}

function toggleActive() {
    return setActive(!active);
}

//---------------------PINS---------------------
// Each thon overlay has its own pin. Pinned keeps it on screen permanently;
// unpinned leaves it hidden until it is shown transiently.
function getPins() {
    return {...pins};
}

function setPinned(overlay, on) {
    pins[overlay] = !!on;
    emit();
    return snapshot();
}

function togglePinned(overlay) {
    pins[overlay] = !pins[overlay];
    emit();
    return snapshot();
}

//---------------------GOALS---------------------
function getGoals() {
    return goalList.slice();
}

//---------------------GIFTS---------------------
// Called by the gift-sub EventSub handler. Gifted subs are logged regardless of
// active state, but only banked (counted) and extended in time while active.
function addGiftSubs(count) {
    if (count > 0 && active) {
        subs += count;
        addMs(count * giftMinutes * 60 * 1000);
        emit();
    }
    return snapshot();
}

function getTimerState() {
    return snapshot();
}

//---------------------WIRING---------------------
// Push the live state to a source the moment it connects (fresh OBS load, reload).
registerOverlay('timer', {
    onConnect: (socket) => {
        try {
            socket.send(JSON.stringify(snapshot()));
        } catch {
            // socket vanished before we could greet it
        }
    }
});

load();
startHeartbeat();

module.exports = {
    getTimerState,
    getPins,
    getGoals,
    isActive,
    setActive,
    toggleActive,
    toggleTimer,
    addTimerMinutes,
    setTimerMinutes,
    setPinned,
    togglePinned,
    addGiftSubs,
    onStateChange
};

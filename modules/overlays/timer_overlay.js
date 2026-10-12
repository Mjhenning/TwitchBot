// modules/overlays/timer_overlay.js
// Bot-authoritative Glosso-thon countdown. Drives the "timer" channel of the
// overlay hub: the bot owns the state (so a browser refresh, OBS blip, or bot
// restart never loses the clock) and pushes it to the source, which only renders.
// Gift subs extend the timer automatically via the EventSub handler; mods control
// it from chat with !timer (on | off | toggle | add | set). The "active" flag is
// the master switch for the whole system: when off the overlay hides and the bot
// ignores timer commands and gift subs.
const fs = require('fs');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {registerOverlay, broadcast} = require('./overlay_hub');

//---------------------TUNING---------------------
const START_MS = (config.TIMER_START_MINUTES || 60) * 60 * 1000; // base length when no saved state
const PER_MS = (config.TIMER_GIFT_MINUTES || 6) * 60 * 1000; // added per gifted sub
const GLOSSOTHON_FILE = config.GLOSSOTHON_FILE;

//---------------------STATE---------------------
let running = false;
let endAt = 0; // epoch ms the run ends, only meaningful while running
let remMs = START_MS; // remaining while paused
let subs = 0; // gifted subs counted this run
let active = false; // master switch: the whole timer system is off until switched on

//--------------------PERSIST--------------------
// The countdown and its banked gift-sub count persist so a new stream picks up
// where the last one left off. The clock always comes back paused: it only ticks
// while the bot is up and a mod has toggled it on, so time never drains between
// streams or while the bot is offline.
function load() {
    try {
        const data = JSON.parse(fs.readFileSync(GLOSSOTHON_FILE, 'utf8'));
        active = !!data.active;
        subs = Number(data.subs) || 0;
        remMs = Number.isFinite(data.remMs) ? Math.max(0, data.remMs) : START_MS;
        running = false;
        endAt = 0;
        Logger.log(`[Timer] Restored ${Math.ceil(remMs / 60000)} min, ${subs} gift sub(s) (${active ? 'active' : 'inactive'})`);
    } catch {
        Logger.warn('[Timer] No saved timer state, starting fresh');
    }
}

function save() {
    try {
        fs.writeFileSync(
            GLOSSOTHON_FILE,
            JSON.stringify({active, remMs: remainingMs(), subs, updatedAt: Date.now()}, null, 2),
            'utf8'
        );
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
        remainingMs: rem,
        running,
        subs,
        done: !running && rem <= 0,
        giftMinutes: config.TIMER_GIFT_MINUTES || 6
    };
}

//---------------------EMIT---------------------
function emit() {
    save();
    broadcast('timer', snapshot());
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
        emit();
    }
    return snapshot();
}

function resumeTimer() {
    if (!running && remMs > 0) {
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
// active controls the whole timer system: the overlay hides and the bot stops
// answering timer commands and gift subs while it is off.
function isActive() {
    return active;
}

// Turning the system off parks the clock (paused) so it cannot drain while
// inactive; turning it on leaves it parked for a mod to resume.
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

// Called by the gift-sub EventSub handler. Extends the clock and banks the sub,
// but only while the timer system is active.
function addGiftSubs(count) {
    if (active && count > 0) {
        subs += count;
        addMs(count * PER_MS);
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
    toggleTimer,
    addTimerMinutes,
    setTimerMinutes,
    addGiftSubs,
    isActive,
    setActive
};

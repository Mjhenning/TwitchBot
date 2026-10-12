// modules/overlays/timer_overlay.js
// Bot-authoritative Glosso-thon countdown. Drives the "timer" channel of the
// overlay hub: the bot owns the state (so a browser refresh, OBS blip, or bot
// restart never loses the clock) and pushes it to the source, which only renders.
// Gift subs extend the timer automatically via the EventSub handler; mods control
// it from chat with !timer / !settimer / !resettimer.
const fs = require('fs');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {registerOverlay, broadcast} = require('./overlay_hub');

//---------------------TUNING---------------------
const START_MS = (config.TIMER_START_MINUTES || 60) * 60 * 1000; // base length, reset target
const PER_MS = (config.TIMER_GIFT_MINUTES || 6) * 60 * 1000; // added per gifted sub
const TIMER_FILE = config.TIMER_FILE;

//---------------------STATE---------------------
let running = false;
let endAt = 0; // epoch ms the run ends, only meaningful while running
let remMs = START_MS; // remaining while paused
let subs = 0; // gifted subs counted this run

//--------------------PERSIST--------------------
function load() {
    try {
        const data = JSON.parse(fs.readFileSync(TIMER_FILE, 'utf8'));
        subs = Number(data.subs) || 0;
        if (data.running && data.endAt) {
            remMs = Math.max(0, data.endAt - Date.now());
            running = remMs > 0;
            endAt = data.endAt;
        } else {
            running = false;
            remMs = Number.isFinite(data.remMs) ? Math.max(0, data.remMs) : START_MS;
        }
    } catch {
        Logger.warn('[Timer] Creating new timer state file');
    }
}

function save() {
    try {
        fs.writeFileSync(
            TIMER_FILE,
            JSON.stringify({running, endAt, remMs, subs, updatedAt: Date.now()}, null, 2),
            'utf8'
        );
    } catch (err) {
        Logger.error(`[Timer] Failed to save state: ${err.message}`);
    }
}

//---------------------STATE MATH---------------------
function remainingMs() {
    return running ? Math.max(0, endAt - Date.now()) : remMs;
}

function snapshot() {
    const rem = remainingMs();
    return {
        type: 'timer',
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

function resetTimer() {
    running = false;
    endAt = 0;
    remMs = START_MS;
    subs = 0;
    emit();
    return snapshot();
}

// Called by the gift-sub EventSub handler. Extends the clock and banks the sub.
function addGiftSubs(count) {
    if (count > 0) {
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

module.exports = {
    getTimerState,
    pauseTimer,
    resumeTimer,
    toggleTimer,
    addTimerMinutes,
    setTimerMinutes,
    resetTimer,
    addGiftSubs
};

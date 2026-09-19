// modules/lurk_tracker.js

const {Logger} = require('../../services');
const {setGate, onRestoreGate} = require('../helpers/session_gates');

const lurkers = new Map(); // userId mapped to { startedAt, name }

function persistLurkers() {
    const snapshot = [...lurkers.entries()].map(([userId, data]) => ({
        userId,
        startedAt: data.startedAt,
        name: data.name
    }));
    setGate('lurkers', snapshot);
}

function startLurk(userId, username) {
    if (lurkers.has(userId)) return; // already lurking
    lurkers.set(userId, {
        startedAt: Date.now(),
        name: username
    });
    persistLurkers();
}

function endLurk(userId) {
    if (!lurkers.has(userId)) return null;

    const data = lurkers.get(userId);
    lurkers.delete(userId);
    persistLurkers();

    const diff = Date.now() - data.startedAt;

    const seconds = Math.floor(diff / 1000) % 60;
    const minutes = Math.floor(diff / (1000 * 60)) % 60;
    const hours = Math.floor(diff / (1000 * 60 * 60));

    return {hours, minutes, seconds, name: data.name};
}

function isLurking(userId) {
    return lurkers.has(userId);
}

function clearLurkers() {
    lurkers.clear();
}

onRestoreGate((gates) => {
    if (!Array.isArray(gates.lurkers)) return;
    for (const entry of gates.lurkers) {
        lurkers.set(entry.userId, {
            startedAt: entry.startedAt,
            name: entry.name
        });
    }
    Logger.log(`[LurkTracker] Restored ${lurkers.size} lurkers`);
});

module.exports = {startLurk, endLurk, isLurking, clearLurkers};
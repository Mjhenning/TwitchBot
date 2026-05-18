// modules/lurk_tracker.js

const lurkers = new Map(); // userId -> { startedAt, name }

function startLurk(userId, username) {
    if (lurkers.has(userId)) return; // already lurking
    lurkers.set(userId, {
        startedAt: Date.now(),
        name: username
    });
}

function endLurk(userId) {
    if (!lurkers.has(userId)) return null;

    const data = lurkers.get(userId);
    lurkers.delete(userId);

    const diff = Date.now() - data.startedAt;

    const seconds = Math.floor(diff / 1000) % 60;
    const minutes = Math.floor(diff / (1000 * 60)) % 60;
    const hours   = Math.floor(diff / (1000 * 60 * 60));

    return { hours, minutes, seconds, name: data.name };
}

function isLurking(userId) {
    return lurkers.has(userId);
}

module.exports = { startLurk, endLurk, isLurking };
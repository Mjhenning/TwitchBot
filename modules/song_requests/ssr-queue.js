// modules/song_requests/ssr-queue.js
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '../../data/ssr_queue.json');

function ensureFile() {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, '[]');
}

function loadQueue() {
    ensureFile();
    try {
        return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveQueue(queue) {
    ensureFile();
    // tmp plus rename keeps the file readable if the process exits mid-write
    const tmp = `${QUEUE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);
}

function pushToQueue(entry) {
    const queue = loadQueue();
    queue.push(entry);
    saveQueue(queue);
    return queue;
}

function shiftQueue() {
    const queue = loadQueue();
    const shifted = queue.shift();
    saveQueue(queue);
    return shifted;
}

function getQueue() {
    return loadQueue();
}

function clearQueue() {
    saveQueue([]);
}

function getQueueLength() {
    return loadQueue().length;
}

module.exports = {pushToQueue, shiftQueue, getQueue, saveQueue, clearQueue, getQueueLength};

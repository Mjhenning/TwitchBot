// modules/ssr-queue.js
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
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
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

module.exports = {pushToQueue, shiftQueue, getQueue, clearQueue, getQueueLength};
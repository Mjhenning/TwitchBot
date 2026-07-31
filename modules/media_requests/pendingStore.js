const fs = require('node:fs/promises');
const path = require('node:path');

const {config} = require('../../config');

let cache = null; // Map<redemptionId, entry>, loaded lazily

async function load() {
    if (cache) return cache;
    try {
        const raw = await fs.readFile(config.PENDING_REDEMPTIONS_PATH, 'utf8');
        cache = new Map(Object.entries(JSON.parse(raw)));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        cache = new Map();
    }
    return cache;
}

async function persist() {
    await fs.mkdir(path.dirname(config.PENDING_REDEMPTIONS_PATH), {recursive: true});
    const obj = Object.fromEntries(cache);
    const tmp = `${config.PENDING_REDEMPTIONS_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fs.rename(tmp, config.PENDING_REDEMPTIONS_PATH); // atomic swap
}

async function setPending(redemptionId, entry) {
    const map = await load();
    map.set(redemptionId, entry);
    await persist();
}

async function getPending(redemptionId) {
    const map = await load();
    return map.get(redemptionId);
}

async function deletePending(redemptionId) {
    const map = await load();
    map.delete(redemptionId);
    await persist();
}

async function getAllPending() {
    const map = await load();
    return [...map.entries()].map(([redemptionId, entry]) => ({redemptionId, ...entry}));
}

module.exports = {setPending, getPending, deletePending, getAllPending};
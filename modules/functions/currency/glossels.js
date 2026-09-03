// modules/Glossels
const fs = require('fs');
const path = require('path');

const {config} = require('../../../config');
const {Logger} = require('../../../services');

// ---------------- CONFIG ----------------
const glosselsGain = [
    {amount: 8, weight: 50},
    {amount: 16, weight: 30},
    {amount: 32, weight: 20},
    {amount: 64, weight: 10},
    {amount: 128, weight: 1}
];

// ---------------- STATE ----------------
let users = [];
let userMap = new Map();
let leaderboard = [];

// ---------------- WATCH (shared file) ----------------
let watcher = null;
let watchTimer = null;

// user_data.json is also written by the Discord bot. Watch the data directory
// (the atomic rename used here changes the inode, so we watch the dir not the
// file) and fold any foreign changes into our in-memory state without losing
// our own pending mutations.
function startUserDataWatch() {
    if (watcher) return;

    const dir = path.dirname(config.CURRENCY_FILE);
    const base = path.basename(config.CURRENCY_FILE);

    try {
        watcher = fs.watch(dir, (eventType, filename) => {
            if (filename !== base) return;

            // debounce the burst of events a single write triggers
            if (watchTimer) clearTimeout(watchTimer);
            watchTimer = setTimeout(() => {
                try {
                    mergeForeignChanges();
                } catch (err) {
                    Logger.error(`[Glossels] Failed to fold foreign change: ${err.message}`);
                }
            }, 300);
        });
        Logger.log(`[Glossels] Watching ${base} for external changes`);
    } catch (err) {
        Logger.warn(`[Glossels] User data watcher failed: ${err.message}`);
        watcher = null;
    }
}

// ---------------- LOAD ----------------
function loadCurrencySystem() {
    try {
        users = JSON.parse(fs.readFileSync(config.CURRENCY_FILE, 'utf8'));

        // normalize + safety, preserve unknown fields (e.g. discordUserId from Discord bot)
        users = users.map(u => ({
            ...(u ?? {}),
            usrName: u.usrName ?? "unknown",
            usrId: u.usrId,
            amount: Number(u.amount) || 0,
            lastCheckin: u.lastCheckin ?? null
        }));

        userMap = new Map(users.map(u => [u.usrId, u]));

        rebuildLeaderboard();

        startUserDataWatch();

    } catch (err) {
        Logger.warn(`[Glossels] Creating new database file: ${err.message}`);
        users = [];
        userMap = new Map();
        leaderboard = [];
        saveCurrencySystem();
        startUserDataWatch();
    }
}

// ---------------- SAVE ----------------
// user_data.json is shared with an external Discord bot. Before writing we
// re-read the file from disk and merge any foreign changes (e.g. discordUserId)
// into this process's copy so we never clobber the other writer's data.
function saveCurrencySystem() {
    mergeForeignChanges();

    const tmp = config.CURRENCY_FILE + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
        fs.renameSync(tmp, config.CURRENCY_FILE);
    } catch (err) {
        Logger.error(`[Glossels] Failed to save user_data.json: ${err.message}`);
    }
}

// Adopt any entries/fields written to user_data.json by the Discord bot.
// For users this process already knows, keep the freshly mutated in-memory
// values but preserve unknown fields (like discordUserId). Users added by the
// other process while we were running get pulled into our in-memory state.
function mergeForeignChanges() {
    let disk = [];
    try {
        disk = JSON.parse(fs.readFileSync(config.CURRENCY_FILE, 'utf8')) || [];
    } catch {
        return; // no readable file, nothing to merge
    }

    const diskMap = new Map(disk.map(u => [u.usrId, u]));

    diskMap.forEach((diskUser, id) => {
        const memUser = userMap.get(id);
        if (memUser) {
            // preserve fields the Twitch bot doesn't manage (e.g. discordUserId)
            for (const key of Object.keys(diskUser)) {
                if (memUser[key] === undefined) memUser[key] = diskUser[key];
            }
            // pick up a display name the other process may have normalized
            if (memUser.usrName === 'unknown' && diskUser.usrName) {
                memUser.usrName = diskUser.usrName;
            }
        } else {
            // new user created by the other process, adopt it
            userMap.set(id, diskUser);
            users.push(diskUser);
        }
    });

    rebuildLeaderboard();
}

// ---------------- CORE ----------------
function addGlossels(userId, amount, userName) {
    const user = getOrCreateUser(userId, userName);

    user.amount += amount;

    markDirty(user);
    saveCurrencySystem();

    return user.amount;
}

function removeGlossels(userId, amount, userName) {
    const user = getOrCreateUser(userId, userName);

    user.amount -= amount;
    if (user.amount < 0) user.amount = 0;

    markDirty(user);
    saveCurrencySystem();

    return user.amount;
}

function retrieveGlossels(userId, userName) {
    return getOrCreateUser(userId, userName).amount;
}

// ---------------- CHECKIN ----------------
function checkin(userId, userName) {
    const user = getOrCreateUser(userId, userName);

    const today = new Date().toISOString().slice(0, 10);

    if (user.lastCheckin === today) return null;

    const reward = getWeightedReward();

    user.amount += reward;
    user.lastCheckin = today;

    markDirty(user);
    saveCurrencySystem();

    return reward;
}

// ---------------- GROUP ACTIONS ----------------
function giveAll(userIds, amount) {
    let affected = 0;

    for (const id of userIds) {
        const user = userMap.get(id);
        if (!user) continue;

        user.amount += amount;
        markDirty(user);
        affected++;
    }

    saveCurrencySystem();
    return affected;
}

function removeAll(userIds, amount) {
    let affected = 0;

    for (const id of userIds) {
        const user = userMap.get(id);
        if (!user) continue;

        user.amount -= amount;
        if (user.amount < 0) user.amount = 0;

        markDirty(user);
        affected++;
    }

    saveCurrencySystem();
    return affected;
}

// ---------------- DELETE USER ----------------
function removeUserEntry(userId) {
    const user = userMap.get(userId);
    if (!user) return false;

    users = users.filter(u => u.usrId !== userId);
    userMap.delete(userId);

    rebuildLeaderboard();

    saveCurrencySystem();
    return true;
}

// ---------------- LOOKUP BY NAME ----------------
function getUserByName(name) {
    const lower = name.toLowerCase();
    return users.find(u => u.usrName.toLowerCase() === lower) ?? null;
}

// ---------------- TRANSFER ----------------
function giveGlossels(fromId, toId, amount) {
    const sender = userMap.get(fromId);
    if (!sender) return {success: false, reason: 'sender_not_found'};
    if (sender.amount < amount) return {success: false, reason: 'insufficient'};
    if (fromId === toId) return {success: false, reason: 'self_transfer'};

    const receiver = userMap.get(toId);
    if (!receiver) return {success: false, reason: 'recipient_not_found'};

    sender.amount -= amount;
    receiver.amount += amount;

    markDirty(sender);
    markDirty(receiver);
    saveCurrencySystem();

    return {success: true, newSenderBalance: sender.amount, newReceiverBalance: receiver.amount};
}

// ---------------- NETWORK CACHE ----------------
const CACHE_PATH = path.join(__dirname, '../../../data/network_cache.json');

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {
        return {balance: 0};
    }
}

function writeCache(data) {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[Glossels] Failed to save network_cache.json: ${err.message}`);
    }
}

function addToCache(amount) {
    const cache = readCache();
    cache.balance += amount;
    writeCache(cache);
    return cache.balance;
}

function drainCache() {
    const cache = readCache();
    const balance = cache.balance;
    cache.balance = 0;
    writeCache(cache);
    return balance;
}

function getCacheBalance() {
    return readCache().balance;
}

// ---------------- LEADERBOARD ----------------
function rebuildLeaderboard() {
    leaderboard = [...users]
        .sort((a, b) => b.amount - a.amount);
}

function getTop5() {
    return leaderboard.slice(0, 5);
}

function getLeaderboard() {
    return [...leaderboard]; // copy, always sorted by amount desc
}

function getUserRank(userId) {
    const index = leaderboard.findIndex(u => u.usrId === userId);
    return index === -1 ? null : index + 1;
}

// ---------------- HELPERS ----------------
function markDirty(user) {
    userMap.set(user.usrId, user);
    rebuildLeaderboard(); // keeps leaderboard always fresh
}

function getWeightedReward() {
    const totalWeight = glosselsGain.reduce((sum, g) => sum + g.weight, 0);
    let random = Math.random() * totalWeight;

    for (const g of glosselsGain) {
        if (random < g.weight) return g.amount;
        random -= g.weight;
    }

    return glosselsGain[0].amount;
}

function getOrCreateUser(userId, userName = "unknown") {
    let user = userMap.get(userId);

    if (!user) {
        user = {
            usrName: userName,
            usrId: userId,
            amount: 0,
            lastCheckin: null
        };

        users.push(user);
        userMap.set(userId, user);
        rebuildLeaderboard();
    }

    user.amount = Number(user.amount) || 0;

    if (user.lastCheckin === undefined) {
        user.lastCheckin = null;
    }

    if (user.usrName !== userName) {
        user.usrName = userName;
    }

    return user;
}

// ---------------- EXPORTS ----------------
module.exports = {
    loadCurrencySystem,
    addGlossels,
    removeGlossels,
    retrieveGlossels,
    checkin,
    giveAll,
    removeAll,
    removeUserEntry,
    getTop5,
    getLeaderboard,
    getUserRank,
    getUserByName,
    giveGlossels,
    addToCache,
    drainCache,
    getCacheBalance,
    getUserMap: () => userMap
};
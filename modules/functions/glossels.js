// modules/Glossels
const fs = require('fs');
const path = require('path');

const {config} = require('../../config');
const {Logger} = require('../../services');

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

// ---------------- LOAD ----------------
function loadCurrencySystem() {
    try {
        users = JSON.parse(fs.readFileSync(config.CURRENCY_FILE, 'utf8'));

        // normalize + safety
        users = users.map(u => ({
            usrName: u.usrName ?? "unknown",
            usrId: u.usrId,
            amount: Number(u.amount) || 0,
            lastCheckin: u.lastCheckin ?? null
        }));

        userMap = new Map(users.map(u => [u.usrId, u]));

        rebuildLeaderboard();

    } catch (err) {
        Logger.warn(`[Glossels] Creating new database file: ${err.message}`);
        users = [];
        userMap = new Map();
        leaderboard = [];
        saveCurrencySystem();
    }
}

// ---------------- SAVE ----------------
function saveCurrencySystem() {
    try {
        fs.writeFileSync(config.CURRENCY_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[Glossels] Failed to save glossels_db.json: ${err.message}`);
    }
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

// ---------------- LEADERBOARD ----------------
function rebuildLeaderboard() {
    leaderboard = [...users]
        .sort((a, b) => b.amount - a.amount);
}

function getTop5() {
    return leaderboard.slice(0, 5);
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
    getUserRank
};
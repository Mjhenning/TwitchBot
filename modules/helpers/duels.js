// modules/helpers/duels.js

const {config} = require("../../config");
const {familyGroupOf} = require("./family_responses");
const {Logger} = require("../../services");

const DUEL_TTL_MS = (config.DUEL_TTL_SECONDS || 60) * 1000;
const BOT_KEY = (config.BOT_NAME || "").toLowerCase();

// pending duels keyed by normalized target name, one request per target
const pending = new Map();

const ARMWRESTLE_LINES = [
    `{winner} overpowers {loser} in the arm wrestle... signal bends, static scatters ✧`,
    `Arms lock... {winner} slams {loser} down, the perimeter holds steady 🫧`,
    `{winner} takes the arm wrestle... {loser}'s signal needs a moment 💾`,
    `{loser} puts up a fight, but {winner} pins them down ✧`
];

const RPS_LINES = [
    `{winner} throws {winThrow}, {loser} throws {loseThrow}... {winThrow} {verb} {loseThrow}, {winner} takes the duel ✧`,
    `Rock paper scissors... {winThrow} beats {loseThrow}, {winner} wins 🫧`,
    `{winner}'s {winThrow} outplays {loser}'s {loseThrow}... duel settled 💾`
];

const COINFLIP_LINES = [
    `{winner} calls {side}... the coin lands {side}, {winner} takes the duel ✧`,
    `The flip lands {side}... {winner}'s call holds, {loser} eats static 🫧`,
    `Coin in the air... {side}. {winner} called it, {loser} did not 💾`
];

const ACCEPT_LINES = [
    `{target} accepts... the {label} begins ✧`,
    `Duel accepted... the line holds its breath 🫧`,
    `{target} steps up... {label} resolved by pure signal luck 💾`
];

const DECLINE_LINES = [
    `{target} declines the duel... the signal settles, no static today ✧`,
    `Duel declined... {target} keeps their coherence intact 🫧`
];

const GAMES = {
    armwrestle: {label: "arm wrestle", accept: ACCEPT_LINES, resolve: resolveArmWrestle},
    rps: {label: "rock paper scissors", accept: ACCEPT_LINES, resolve: resolveRps},
    coinflip: {label: "coin flip", accept: ACCEPT_LINES, resolve: resolveCoinFlip}
};

const REQUEST_LINES = [
    `{senderName} throws down the signal gauntlet at {target}... type !accept to step up ✧`,
    `{target}, {senderName} demands a duel... !accept joins, anything else lets it pass 🫧`,
    `A duel request hums between {senderName} and {target}... !accept to accept 💾`
];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
    );
}

// normalize a typed target: strip one leading @, collapse case
function normalize(name) {
    return String(name || "").replace(/^@/, "").trim().toLowerCase();
}

// does this stored target key match this participant's login or display name
function keyMatches(targetKey, login, name) {
    const lowerName = String(name || "").toLowerCase();
    if (targetKey === String(login || "").toLowerCase() || targetKey === lowerName) return true;
    const typedGroup = familyGroupOf(targetKey);
    // aliases for the family members, so "silver" matches tinysilverfoxx's accept
    return !!typedGroup && familyGroupOf(String(login || "").toLowerCase()) === typedGroup;
}

function purgeExpired() {
    const now = Date.now();
    for (const [key, duel] of pending) {
        if (duel.expiresAt <= now) pending.delete(key);
    }
}

function resolveArmWrestle(a, b) {
    const aFirst = Math.random() < 0.5;
    const winner = aFirst ? a : b;
    const loser = aFirst ? b : a;
    return fill(pick(ARMWRESTLE_LINES), {winner, loser});
}

function resolveRps(a, b) {
    const aFirst = Math.random() < 0.5;
    const winner = aFirst ? a : b;
    const loser = aFirst ? b : a;

    const throws = ["rock", "paper", "scissors"];
    const beats = {rock: "scissors", paper: "rock", scissors: "paper"};
    const verb = {rock: "crushes", paper: "covers", scissors: "cut"};

    const winThrow = pick(throws);
    const loseThrow = beats[winThrow];

    return fill(pick(RPS_LINES), {winner, loser, winThrow, loseThrow, verb: verb[winThrow]});
}

function resolveCoinFlip(a, b) {
    const aFirst = Math.random() < 0.5;
    const winner = aFirst ? a : b;
    const loser = aFirst ? b : a;
    const side = pick(["heads", "tails"]);

    return fill(pick(COINFLIP_LINES), {winner, loser, side});
}

// challenge a user to a duel, returns an array of lines for the bot to say
function requestDuel(gameKey, targetRaw, senderName, senderId, senderLogin, commandLabel) {
    const target = String(targetRaw || "").replace(/^@/, "").trim().slice(0, 25);
    if (!target) return [`Usage: ${commandLabel || "!" + gameKey} @user ✧`];
    const targetKey = target.toLowerCase();

    purgeExpired();

    if (keyMatches(targetKey, senderLogin, senderName)) {
        return [`${senderName} tries to duel themselves... the signal refuses 🫧`];
    }
    if (targetKey === BOT_KEY) {
        return [`The bot declines... it has seen enough static already ✧`];
    }
    if (pending.has(targetKey)) {
        return [`${target} already has a duel request waiting... one at a time 💾`];
    }
    for (const duel of pending.values()) {
        if (duel.challengerId === senderId) {
            return [`${senderName}, finish your current duel request first ✧`];
        }
    }

    const game = GAMES[gameKey];
    if (!game) return [];

    pending.set(targetKey, {
        challengerId: senderId,
        challengerName: senderName,
        targetKey,
        targetName: target,
        gameKey,
        expiresAt: Date.now() + DUEL_TTL_MS
    });

    Logger.log(`[Duels] ${senderName} challenged ${target} to a duel of ${game.label}`);
    return [fill(pick(REQUEST_LINES), {senderName, target})];
}

// the target responds to a pending duel; accept resolves immediately (empty array means silent)
function answerDuel(action, senderName, senderLogin) {
    purgeExpired();

    let found = null;
    for (const [key, duel] of pending) {
        if (keyMatches(key, senderLogin, senderName)) {
            found = {key, duel};
            break;
        }
    }
    if (!found) return [];

    const {duel} = found;
    pending.delete(found.key);

    if (action === "decline") {
        Logger.log(`[Duels] ${senderName} declined a duel of ${GAMES[duel.gameKey].label}`);
        return [fill(pick(DECLINE_LINES), {target: senderName})];
    }

    const game = GAMES[duel.gameKey];
    const acceptLine = fill(pick(game.accept), {target: senderName, label: game.label});
    const resolutionLine = game.resolve(duel.challengerName, senderName);

    Logger.log(`[Duels] ${duel.challengerName} vs ${senderName} resolved a duel of ${game.label}`);
    return [acceptLine, resolutionLine];
}

// the challenger can withdraw while waiting; silent if nothing pending
function cancelDuel(senderId) {
    purgeExpired();

    for (const [key, duel] of pending) {
        if (duel.challengerId === senderId) {
            pending.delete(key);
            Logger.log(`[Duels] ${duel.challengerName} cancelled a duel of ${GAMES[duel.gameKey].label}`);
            return [`${duel.challengerName} withdraws the duel request... the gauntlet retracts 💾`];
        }
    }
    return [];
}

module.exports = {
    requestDuel,
    answerDuel,
    cancelDuel
};

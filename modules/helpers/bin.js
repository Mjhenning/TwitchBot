// modules/helpers/bin.js

const {config} = require("../../config");
const {Logger} = require("../../services");

const MIN_MS = (config.BIN_RECOVERY_MIN_SECONDS || 45) * 1000;
const MAX_MS = (config.BIN_RECOVERY_MAX_SECONDS || 90) * 1000;

// targetKey -> {timer, targetName, binnerName}; re-binning refreshes the timer
const activeBins = new Map();

const BIN_LINES = [
    `{senderName} yeets {target} into the recycling bin... the compactor hums, signal compacted 💾`,
    `{senderName} bins {target} into the recycling... after a time, they will return ✧`,
    `{target} has been thrown in the recycling bin by {senderName}... compactor whirs, static squeezed out 🫧`,
    `{senderName} drops {target} in the recycling bin... they will return after a time, slightly used 💾`
];

const REBIN_LINES = [
    `{target} is already in the recycling bin... {senderName} tosses them back in, compactor doubles down ✧`,
    `{senderName} re-bins {target}... the compactor does not judge, it only compacts 🫧`
];

const RECOVERY_LINES = [
    `After a time... {target} climbs back out of the recycling bin, mostly intact ✧`,
    `Some time later... {binner}'s recycling bin releases {target}, signal slightly compacted 💾`,
    `{target} pops back out of the recycling bin... recovered, refreshed, mildly dented 🫧`
];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
    );
}

function throwInBin(client, channel, targetRaw, senderName) {
    const target = String(targetRaw || "").replace(/^@/, "").trim().slice(0, 25);
    if (!target) return `Usage: !bin @user ✧`;
    const key = target.toLowerCase();

    const existing = activeBins.get(key);
    if (existing) {
        clearTimeout(existing.timer);
    }

    const line = fill(existing ? pick(REBIN_LINES) : pick(BIN_LINES), {senderName, target});

    armRecovery(client, channel, key, target, senderName);
    return line;
}

function armRecovery(client, channel, key, targetName, binnerName) {
    // hidden random delay, "after a time" is literal, the countdown is never announced
    const delay = MIN_MS + Math.random() * (MAX_MS - MIN_MS);

    const timer = setTimeout(() => {
        activeBins.delete(key);
        const line = fill(pick(RECOVERY_LINES), {target: targetName, binner: binnerName});
        const sent = client.say(channel, line);
        if (sent && typeof sent.catch === "function") {
            sent.catch(err => Logger.error(`[Bin] recovery say failed: ${err.message}`));
        }
    }, delay);

    timer.unref(); // flavor only, never hold the process open
    activeBins.set(key, {timer, targetName, binnerName});
    Logger.log(`[Bin] ${binnerName} binned ${targetName} (hidden recovery timer armed)`);
}

module.exports = {
    throwInBin
};

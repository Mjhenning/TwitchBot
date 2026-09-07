// modules/helpers/timed_commands.js
// Drives data/timed_commands.json: periodic chat messages and function calls with
// randomized offsets, intervals, and optional conditions. Auto-pauses offline,
// auto-resumes online. Add new scheduled entries in the JSON config; register new
// condition/function names in conditionMap/functionMap below.
const fs = require('fs');
const path = require('path');
const {config} = require('../../config');
const {Logger} = require('../../services');
const {getIsOnline, onOnline, onOffline} = require('./stream-state');
const {discordCommand, socialCommand, getSsrEnabled, getMrEnabled} = require('../../commands/registry');

const conditionMap = {
    ssrEnabled: getSsrEnabled,
    mrEnabled: getMrEnabled
};

const functionMap = {
    discordCommand,
    socialCommand
};

let activeStopFunctions = [];

function parseTime(value) {
    if (typeof value === 'number') return value;
    const match = value.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) throw new Error(`[TimedCommands] Invalid time format: "${value}"`);
    const num = parseInt(match[1]);
    const unit = match[2];
    const multipliers = {ms: 1, s: 1000, m: 60000, h: 3600000};
    return num * multipliers[unit];
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleCommand(entry, client, channel) {
    let activeTimeout = null;

    const startSequence = () => {
        const offset = randomBetween(parseTime(entry.offsetMin), parseTime(entry.offsetMax));
        Logger.log(`[TimedCommands] "${entry.id}" starting in ${Math.round(offset / 1000)}s`);

        const fire = async () => {
            if (entry.condition) {
                const conditionFn = conditionMap[entry.condition];
                if (conditionFn && !conditionFn()) {
                    Logger.log(`[TimedCommands] "${entry.id}" skipped, condition "${entry.condition}" is false`);
                    const nextFire = parseTime(entry.interval);
                    Logger.log(`[TimedCommands] "${entry.id}" next fire in ${Math.round(nextFire / 1000)}s`);
                    activeTimeout = setTimeout(fire, nextFire);
                    return;
                }
            }

            try {
                if (entry.type === 'function') {
                    const fn = functionMap[entry.function];
                    if (!fn) {
                        Logger.error(`[TimedCommands] Unknown function: ${entry.function}`);
                    } else {
                        Logger.log(`[TimedCommands] Firing function "${entry.function}"`);
                        await fn(client, channel);
                    }
                } else if (entry.type === 'message') {
                    Logger.log(`[TimedCommands] Firing message "${entry.id}"`);
                    client.say(channel, entry.message);
                }
            } catch (err) {
                Logger.error(`[TimedCommands] Error firing "${entry.id}": ${err.message}`);
            }

            const nextFire = parseTime(entry.interval);
            Logger.log(`[TimedCommands] "${entry.id}" next fire in ${Math.round(nextFire / 1000)}s`);
            activeTimeout = setTimeout(fire, nextFire);
        };

        activeTimeout = setTimeout(fire, offset);
    };

    const stop = () => {
        if (activeTimeout) {
            clearTimeout(activeTimeout);
            activeTimeout = null;
            Logger.log(`[TimedCommands] "${entry.id}" stopped`);
        }
    };

    onOffline(stop);
    onOnline(startSequence);

    activeStopFunctions.push(stop);  // register for module-level stop

    if (getIsOnline()) {
        startSequence();
    } else {
        Logger.log(`[TimedCommands] "${entry.id}" waiting for stream to go online...`);
    }
}

function startTimedCommands(client, channel) {
    activeStopFunctions = [];
    let entries;
    try {
        entries = JSON.parse(fs.readFileSync(config.TIMED_COMMANDS_FILE, 'utf8'));
    } catch (err) {
        Logger.error(`[TimedCommands] Failed to load TimedCommands.json: ${err.message}`);
        return;
    }

    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;

    for (const entry of entries) {
        scheduleCommand(entry, client, formattedChannel);
    }

    Logger.log(`[TimedCommands] ${entries.length} timed command(s) scheduled`);
}

function stopTimedCommands() {
    activeStopFunctions.forEach(fn => fn());
    activeStopFunctions = [];
    Logger.log('[TimedCommands] All timers stopped');
}

module.exports = {startTimedCommands, stopTimedCommands};
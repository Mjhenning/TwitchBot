// modules/timer.js
const fs = require('fs');
const path = require('path');
const { getIsOnline, onOnline, onOffline } = require('./stream-state');
const { discordCommand, ytCommand, devCommand, getSsrEnabled } = require('../commands/registry');

const COMMANDS_FILE = path.join(__dirname, '../data/timed_commands.json');

const conditionMap = {
    ssrEnabled: getSsrEnabled
};

const functionMap = {
    discordCommand,
    devCommand,
    ytCommand
};

function parseTime(value) {
    if (typeof value === 'number') return value;
    const match = value.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) throw new Error(`[Timer] Invalid time format: "${value}"`);
    const num = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000 };
    return num * multipliers[unit];
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleCommand(entry, client, channel) {
    let activeTimeout = null;

    const startSequence = () => {
        const offset = randomBetween(parseTime(entry.offsetMin), parseTime(entry.offsetMax));
        console.log(`[Timer] "${entry.id}" starting in ${Math.round(offset / 1000)}s`);

        const fire = async () => {
            if (entry.condition) {
                const conditionFn = conditionMap[entry.condition];
                if (conditionFn && !conditionFn()) {
                    console.log(`[Timer] "${entry.id}" skipped — condition "${entry.condition}" is false`);
                    const nextFire = parseTime(entry.interval);
                    console.log(`[Timer] "${entry.id}" next fire in ${Math.round(nextFire / 1000)}s`);
                    activeTimeout = setTimeout(fire, nextFire);
                    return;
                }
            }

            try {
                if (entry.type === 'function') {
                    const fn = functionMap[entry.function];
                    if (!fn) {
                        console.error(`[Timer] Unknown function: ${entry.function}`);
                    } else {
                        console.log(`[Timer] Firing function "${entry.function}"`);
                        await fn(client, channel);
                    }
                } else if (entry.type === 'message') {
                    console.log(`[Timer] Firing message "${entry.id}"`);
                    client.say(channel, entry.message);
                }
            } catch (err) {
                console.error(`[Timer] Error firing "${entry.id}":`, err.message);
            }

            const nextFire = parseTime(entry.interval);
            console.log(`[Timer] "${entry.id}" next fire in ${Math.round(nextFire / 1000)}s`);
            activeTimeout = setTimeout(fire, nextFire);
        };

        activeTimeout = setTimeout(fire, offset);
    };

    const stop = () => {
        if (activeTimeout) {
            clearTimeout(activeTimeout);
            activeTimeout = null;
            console.log(`[Timer] "${entry.id}" stopped — stream offline`);
        }
    };

    onOffline(stop);
    onOnline(startSequence);

    if (getIsOnline()) {
        startSequence();
    } else {
        console.log(`[Timer] "${entry.id}" waiting for stream to go online...`);
    }
}

function startTimers(client, channel) {
    let entries;
    try {
        entries = JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf8'));
    } catch (err) {
        console.error('[Timer] Failed to load TimedCommands.json:', err.message);
        return;
    }

    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;

    for (const entry of entries) {
        scheduleCommand(entry, client, formattedChannel);
    }

    console.log(`[Timer] ${entries.length} timed command(s) scheduled`);
}

module.exports = { startTimers };
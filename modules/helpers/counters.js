const fs = require("fs");
const path = require("path");

const {config} = require("../../config");

function loadCounters() {
    return JSON.parse(fs.readFileSync(config.COUNTER_PATH, "utf8"));
}

function saveCounters() {
    fs.writeFileSync(config.COUNTER_PATH, JSON.stringify(counters, null, 2));
}

// Parse the action string: bare "increment by 1", "+N"/"-N" adjustment, or "=N" set.
function parseAction(action) {

    if (!action)
        return {type: "increment", amount: 1};

    if (/^[+-]\d+$/.test(action))
        return {
            type: "increment",
            amount: parseInt(action)
        };

    if (/^=\d+$/.test(action))
        return {
            type: "set",
            amount: parseInt(action.substring(1))
        };

    return {
        type: action.toLowerCase()
    };
}


let counters = loadCounters();

// Handle counter fallback commands. Returns true when the command was consumed, false to pass through.
function handleCounter(client, channel, command, action, isMod) {

    const commandName = command.toLowerCase();

    const counter = counters.find(c =>
        c.commands.some(alias => alias.toLowerCase() === commandName)
    );

    if (!counter)
        return false;

    const parsed = parseAction(action);

    switch (parsed.type) {

        case "increment":

            if (!isMod && parsed.amount !== 1) {
                client.say(channel, "Only moderators can change a counter by more than 1.");
                return true;
            }

            counter.amount += parsed.amount;
            break;

        case "set":

            if (!isMod) {
                client.say(channel, "Only moderators can set a counter.");
                return true;
            }

            counter.amount = parsed.amount;
            break;

        case "stats":

            client.say(channel, `${counter.id}: ${counter.amount}`);
            return true;

        case "last": {

            const date = new Date(counter.lastCounted);

            const formatted = date.toLocaleString("en-ZA", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });

            client.say(channel, `Last counted: ${formatted}`);
            return true;
        }

        default:
            return false;
    }

    counter.lastCounted = new Date().toISOString();
    saveCounters();

    // Reply with a random response template from the config, filling in the new count.
    const response =
        counter.responses[
            Math.floor(Math.random() * counter.responses.length)
            ].replace("{count}", counter.amount);

    client.say(channel, response);

    return true;
}

module.exports = {
    handleCounter
};
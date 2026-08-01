// commands/chat_integration.js
const axios = require('axios');

// modules
const {handleDaemonRelatedResponses} = require('../modules/bot_specific/bot_response_modules');
const {endLurk, isLurking} = require('../modules/functions/lurk_tracker');
const {clearQueue} = require('../modules/song_requests/ssr-queue');
const {startSSRPolling} = require('../modules/song_requests/pear-desktop-music');
const {handleCooldown: _handleCooldown} = require('../modules/helpers/cooldown');

const {
    devCommand,
    discordCommand,
    ytCommand,
    raidCommand,
    backseatCommand,
    clipCommand,
    lurkCommand,
    followAgeCommand,
    shoutoutCommand,
    followTestCommand,
    raidTestCommand,
    adBreakTestCommand,
    clearQCommand,
    closeQCommand,
    openQCommand,
    ssrCommand,
    skipCommand,
    qCommand,
    currentSongCommand,
    tailCommand,
    fishCommand,
    hugCommand,
    counterCommand,
    handleModeration,
    openMrCommand,
    closeMrCommand
} = require('./registry');

const {getBalanceCommand, getRankCommand, getTop5Command} = require('./registry');
const {argSystemCommand, argSystemAdminCommand} = require('./registry')

//--------------------------------- HELPERS ------------------------------------
let lastDenied = 0;

function requireMod(tags, client, channel) {
    const isMod = tags.mod || tags.badges?.broadcaster === '1';
    if (!isMod) {
        const now = Date.now();
        if (now - lastDenied > 5000) {
            client.say(channel, `Permission denied... this command is restricted ✧`);
            lastDenied = now;
        }
        return false;
    }
    return true;
}

function hasCommand(msg, command) {
    const regex = new RegExp(`(^|\\s)${command}(?=\\s|$|[^\\w])`, 'i');
    return regex.test(msg);
}

// ------------------- main -------------------
function setupChatCommands(client, config) {
    startSSRPolling(client, config.CHANNEL_NAME);

    client.on('message', async (channel, tags, message, self) => {
        if (self) return;

        const sourceRoomId = tags['source-room-id'] || tags['room-id'];
        const isFromMyChannel = sourceRoomId === config.BROADCASTER_ID;

        if (!isFromMyChannel) {
            return;
        }

        const msg = message.trim();
        const lower = msg.toLowerCase();
        const senderName = tags['display-name'] || tags['username'];
        const userId = tags['user-id'];
        const isBroadcaster = tags.badges?.broadcaster === '1';

        // ------------------- AUTOMOD -------------------

        if (
            await handleModeration(
                client,
                channel,
                tags,
                msg
            )
        ) {
            return;
        }


        //--------------------------------- FUNCTIONAL HELPERS ------------------------------------

        function handleCooldown(command, customCooldown = null) {
            return _handleCooldown(userId, senderName, command, tags, client, channel, customCooldown);
        }

        // ------------------- auto-unlurk -------------------
        if (isLurking(userId)) {

            if (hasCommand(lower, '!lurk')) {
                const errorMessages = [
                    `Lurk process already detected... ignoring duplicate request 💾`,
                    `${senderName}, you're already in lurk mode ✧`,
                    `You are already lurking... no new session started 🫧`
                ];

                client.say(channel, errorMessages[Math.floor(Math.random() * errorMessages.length)]);
                endLurk(userId)
                return;
            }
            const time = endLurk(userId);
            const {hours, minutes, seconds, name} = time;

            const parts = [];
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);
            if (seconds > 0) parts.push(`${seconds}s`);

            const duration = parts.join(' ') || 'a moment';

            const returnMessages = [
                `${name} has returned after ${duration} in the shadows... welcome back ✧`,
                `Connection restored... ${name} reappeared after ${duration} ✨`,
                `${name} re-rendered after ${duration} of quiet observation 🫧`
            ];

            client.say(channel, returnMessages[Math.floor(Math.random() * returnMessages.length)]);
            return; // STOP everything else
        }


        // ------------------- COMMANDS -------------------
        if (hasCommand(lower, '!song') || hasCommand(lower, '!currentsong')) {
            await currentSongCommand(client, channel);
            return;
        }

        if (hasCommand(lower, '!Q') || hasCommand(lower, '!queue')) {
            if (handleCooldown('queue')) return;
            await qCommand(client, channel);
            return;
        }

        if (lower.startsWith('!sr')) {
            if (handleCooldown('sr', 30)) return;
            await ssrCommand(client, channel, senderName, msg, isBroadcaster);
            return;
        }

        if (lower.startsWith('!followage')) {
            if (handleCooldown('followage')) return;
            await followAgeCommand(client, channel, userId, senderName, msg);
            return;
        }

        if (lower.startsWith('!so')) {
            if (handleCooldown('so')) return;
            await shoutoutCommand(client, msg);
            return;
        }

        if (hasCommand(lower, '!lurk')) {
            if (handleCooldown('lurk')) return;

            lurkCommand(client, channel, userId, senderName);
            return;
        }

        if (hasCommand(lower, '!clip')) {
            if (handleCooldown('clip')) return;
            await clipCommand(client, channel, senderName);
            return;
        }

        if (hasCommand(lower, '!backseat')) {
            if (handleCooldown('backseat')) return;
            backseatCommand(client);
            return;
        }

        if (hasCommand(lower, '!dev')) {
            devCommand(client);
            return;
        }

        if (hasCommand(lower, '!raid')) {
            raidCommand(client);
            return;
        }

        if (hasCommand(lower, '!discord')) {
            discordCommand(client);
            return;
        }

        if (hasCommand(lower, '!yt')) {
            ytCommand(client);
            return;
        }

        if (hasCommand(lower, '!tail') || hasCommand(lower, '!tails')) {
            tailCommand(client);
            return;
        }

        if (hasCommand(lower, '!glossels')) {
            getBalanceCommand(client, channel, userId, senderName);
            return
        }

        if (hasCommand(lower, '!rank')) {
            getRankCommand(client, channel, userId, senderName);
            return;
        }

        if (hasCommand(lower, '!top5')) {
            getTop5Command(client, channel);
            return;
        }

        if (lower.startsWith('!system') || lower.startsWith('!sys')) {
            argSystemCommand(client, channel, userId, senderName, tags, msg);
            return
        }

        if (lower.startsWith('!sysAdmin')) {
            argSystemAdminCommand(client, channel, userId, senderName, tags, msg);
            return
        }

        if (hasCommand(lower, 'fish') || hasCommand(lower, 'feesh') || hasCommand(lower, 'fih')) {
            fishCommand(client, channel);
            return
        }

        if (lower.startsWith('!hug')) {
            if (handleCooldown('hug')) return;
            hugCommand(client, channel, senderName, msg);
            return;
        }

        // ------------------- MOD COMMANDS -------------------
        if (hasCommand(lower, '!skip')) {
            if (!requireMod(tags, client, channel)) return;
            await skipCommand(client, channel);
            return;
        }

        if (hasCommand(lower, '!opensr') || hasCommand(lower, '!startsr')) {
            if (!requireMod(tags, client, channel)) return;
            openQCommand(client, channel);
            return;
        }

        if (hasCommand(lower, '!closesr') || hasCommand(lower, '!stopsr')) {
            if (!requireMod(tags, client, channel)) return;
            closeQCommand(client, channel);
            return;
        }

        if (hasCommand(lower, '!clearQ')) {
            if (!requireMod(tags, client, channel)) return;
            clearQCommand(client, channel);
            return;
        }

        if (hasCommand(lower, '!openmr') || hasCommand(lower, '!startmr')) {
            if (!requireMod(tags, client, channel)) return;
            await openMrCommand(client, channel, config);
            return;
        }

        if (hasCommand(lower, '!closemr') || hasCommand(lower, '!stopmr')) {
            if (!requireMod(tags, client, channel)) return;
            await closeMrCommand(client, channel, config);
            return;
        }

        if (hasCommand(lower, '!testfollow')) {
            if (!requireMod(tags, client, channel)) return;
            if (handleCooldown('testfollow')) return;
            followTestCommand(client, senderName);
            return;
        }

        if (hasCommand(lower, '!testraid')) {
            if (!requireMod(tags, client, channel)) return;
            if (handleCooldown('testraid')) return;
            // usage: !testraid [raiderName] [viewers]
            // e.g.   !testraid CoolStreamer 150
            const parts = msg.trim().split(/\s+/);
            const raiderName = parts[1] ?? senderName;
            const viewers = parseInt(parts[2]) || 42;
            raidTestCommand(client, raiderName, viewers);
            return;
        }

        if (hasCommand(lower, '!testads')) {
            if (!requireMod(tags, client, channel)) return;
            if (handleCooldown('testads')) return;
            // usage: !testads [duration] [auto|manual] [requesterName]
            // e.g.   !testads 60 manual SomeMod
            const parts = msg.trim().split(/\s+/);
            const duration = parseInt(parts[1]) || 30;
            const isAutomatic = (parts[2] ?? 'auto') !== 'manual';
            const requester = parts[3] ?? null;
            adBreakTestCommand(client, duration, isAutomatic, requester);
            return;
        }

        if (lower.startsWith("!")) {
            const parts = lower.substring(1).split(/\s+/);

            const command = parts[0];
            const action = parts[1] ?? null;

            const isMod = tags.mod || tags.badges?.broadcaster === "1";

            if (await counterCommand(client, channel, command, action, isMod))
                return;
        }

        // ------------------- daemon greeting ------------------- (AT BOTTOM TO AVOID OVERWRITING COMMANDS)
        if (
            handleDaemonRelatedResponses({
                message: msg,
                senderName,
                client,
                channel
            })
        ) {

        }

    });
}

module.exports = {setupChatCommands};

process.on('exit', clearQueue);           // normal exit
process.on('SIGINT', () => {
    clearQueue();
    process.exit();
});   // Ctrl+C
process.on('SIGTERM', () => {
    clearQueue();
    process.exit();
});  // kill command
process.on('uncaughtException', (err) => {
    console.error(err);
    clearQueue();
    process.exit();
});
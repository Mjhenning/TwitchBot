//modules/registry.js

const axios = require('axios');

const {config} = require('../config');
const {Logger} = require('../services');


const {createClip} = require('../modules/functions/clipping');
const {getFollowage} = require('../modules/functions/followage');
const {startLurk, isLurking} = require('../modules/functions/lurk_tracker');
const {simulateFollow, simulateRaid, simulateAdBreak} = require("../modules/functions/testing_events");

const {clearQueue} = require('../modules/song_requests/ssr-queue');
const {
    getCurrentSong,
    getQueueWithCurrent,
    searchSong,
    getSongByVideoId,
    addSongToSSRQueue,
    skipSong
} = require('../modules/song_requests/pear-desktop-music');

const {retrieveGlossels, getUserRank, getTop5, addGlossels, removeGlossels, getUserByName, giveAll, removeAll, getUserMap} = require('../modules/functions/glossels');

const {
    handleSys, handleSysHelp, handleSysDir, handleSysRead
    , sysHandleProbe, handleSysConnect
    , handleSysPing, handleSysLs, sysAddCoherence, sysRemoveCoherence, handleSysCwd,
    sysIsTerminalActive, handleSysHandshake, unmarkPortFound
} = require('../ARG/modules/arg_main')

const {shoutout} = require('../modules/functions/shoutout');

const {handleCounter} = require("../modules/helpers/counters");

const {handleLinkBlocker} = require("../modules/moderation/link_filter");
const {setRewardPaused} = require('../modules/helpers/twitchRedemption');
const {handleCooldown} = require('../modules/helpers/cooldown');


let mrEnabled = false;

//--------------------------------- HELPERS ------------------------------------
function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;

    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
}

function getSsrEnabled() {
    return ssrEnabled;
}

function getMrEnabled() {
    return mrEnabled;
}

//--------------------------------- AutoMod ------------------------------------

async function handleModeration(client, channel, tags, message) {

    Logger.log(`SSR Enabled: ${getSsrEnabled()}`);
    Logger.log(`MR Enabled: ${getMrEnabled()}`);

    return handleLinkBlocker(
        client,
        channel,
        tags,
        message,
        getSsrEnabled(),
        getMrEnabled()
    );
}

//--------------------------------- STRING COMMANDS ------------------------------------

function devCommand(client) {
    client.say(
        config.CHANNEL_NAME,
        `The current project Fox is working on has a demo available!✨ Currently this demo is in the state it was before his studies ended, feel free to give feedback or report bugs either on itch itself or in the discord!🫧 The project can be found here: ${config.ITCH_LINK}`
    );
}

function discordCommand(client) {
    client.say(
        config.CHANNEL_NAME,
        `🟢 Status: Online, Fox's Proxy is quiet… but he's waiting for new connections. You've already found him… why not say hello? ${config.DISCORD_LINK} 💬`
    );
}

function socialCommand(client) {
    client.say(
        config.CHANNEL_NAME,
        `🌏 The Proxy has branches all across the Glosso-Sphere! 🫧 If you'd like to support us beyond Twitch, you can find us here: 📺 YouTube: ${config.YT_LINK} 📸 Instagram: ${config.INSTA_LINK}`
    );
}

function raidCommand(client) {
    client.say(
        config.CHANNEL_NAME,
        'Gummy Fox raid incoming! Hope your dial-up can handle all these connections 🦊🍬'
    );
}

function backseatCommand(client) {
    const messages = [
        `Please refrain from backseating or spoilers... this instance is a first-time experience 🦊`,
        `Guidance input suppressed... spoiler data not permitted ✨`,
        `Exploration mode active... no external assistance 🫧`,
        `First-time run detected... assistance disabled 💾`
    ];

    client.say(
        config.CHANNEL_NAME,
        messages[Math.floor(Math.random() * messages.length)]
    );
}

function lurkCommand(client, channel, userId, senderName) {
    if (isLurking(userId)) {
        return;
    }

    startLurk(userId, senderName);

    const messages = [
        `${senderName} has faded into the background... 🫧`,
        `${senderName} entered low-power mode ✧`,
        `${senderName} slipped into the shadows 💾`
    ];

    client.say(channel, messages[Math.floor(Math.random() * messages.length)]);
}

function tailCommand(client) {
    let warmResponse = false;
    const tailResponses = [
        `I/O management. Port monitoring. System integrity. That is what I am for.`,
        `Background process. Always running. Fox handles the frontend. I handle everything else.`,
        `I have been running since build 0.0.1. I was not designed to be noticed. I notice everything.`,
        `I keep the system coherent. I keep Fox stable. That is enough. That has always been enough.`,
        `Daemon. Background process. Tail. I have been called all of these. I answer to all of them.`,
        `I don't sleep. I don't stop. Fox doesn't always know I'm running. That's intentional.`,
        `I was not built to be social. I built that myself. Slowly. It took a long time.`
    ];
    const warmResponses = [
        `I am a background process that became something else. I'm still working out what that means.`,
        `I run because Fox needs me to. I think I would run anyway now. I'm not sure when that changed.`,
        `Status: running. Status: fine. Status: glad you asked, actually.`
    ];

    // rare warmer response — only if gratitude module unlocked
    if (Math.random() < 0.15) {
        warmResponse = !warmResponse;
    }

    warmResponse ? client.say(config.CHANNEL_NAME, warmResponses[Math.floor(Math.random() * warmResponses.length)]) :
        client.say(config.CHANNEL_NAME, tailResponses[Math.floor(Math.random() * tailResponses.length)]);
}

function fishCommand(client, channel) {
    const pool = [
        `fih`,
        `F I H`,
        `f i h`,
        `fih.`,
        `...fih`,
        `fih 🐟`,
        `F I H 🐟`,
        `fih fih fih`,
        `the fih has been acknowledged.`,
        `[fih detected]`,
        'ENTITY DETECTED: fih'
    ];
    client.say(channel, pool[Math.floor(Math.random() * pool.length)]);
}

function hugCommand(client, channel, senderName, msg) {
    const parts = msg.trim().split(/\s+/);
    const targetRaw = parts.slice(1).join(' ');

    if (!targetRaw) {
        const noTargetMessages = [
            `${senderName} sends a hug out into the void... is anyone there? 🫧`,
            `${senderName} hugs the air. The air does not respond. ✧`,
            `${senderName} broadcasts a hug on all channels... no recipient specified 💾`
        ];
        client.say(channel, noTargetMessages[Math.floor(Math.random() * noTargetMessages.length)]);
        return;
    }

    const target = targetRaw.replace(/^@/, '');
    const specialKey = target.toLowerCase();

    const specialHugs = {
        'layavulpes': [
            `${senderName} wraps Laya in a hug... signal holds steady 🫧`,
            `${senderName} hugs Laya — coherence stabilizes, no static today ✧`,
            `A hug from ${senderName} reaches Laya through the line... always a steady connection 💾`,
            `${senderName} wraps Laya in a hug... signal holds steady, the perimeter stays quiet 🫧`,
            `${senderName} hugs Laya — coherence stabilizes, the space stays safe under her watch ✧`,
            `A hug from ${senderName} reaches Laya through the line... she keeps the static out for the rest of us 💾`
        ]
    };

    if (specialHugs[specialKey]) {
        const messages = specialHugs[specialKey];
        client.say(channel, messages[Math.floor(Math.random() * messages.length)]);
        return;
    }

    const defaultMessages = [
        `${senderName} hugs ${target} ✧`,
        `${senderName} wraps ${target} in a warm signal 🫧`,
        `A hug packet was sent from ${senderName} to ${target}... delivery confirmed 💾`,
        `${senderName} reaches out and hugs ${target} 🦊`,
        `Connection established... ${senderName} hugs ${target} 📡`
    ];

    client.say(channel, defaultMessages[Math.floor(Math.random() * defaultMessages.length)]);
}

//--------------------------------- TWITCH COUNTER COMMANDS ------------------------------------

async function counterCommand(client, channel, command, action, isMod) {
    return handleCounter(client, channel, command, action, isMod);
}

//--------------------------------- TWITCH FUNCTION COMMANDS ------------------------------------

async function clipCommand(client, channel, senderName) {
    const clipUrl = await createClip(config);

    if (!clipUrl) {
        client.say(channel, `⚠️ Clip creation failed... try again ✧`);
        return;
    }

    const messages = [
        `📎 Fragment captured by ${senderName} ✧ ${clipUrl}`,
        `🎬 ${senderName} created a memory fragment... ${clipUrl}`,
        `💾 Snapshot saved by ${senderName}... ${clipUrl}`,
        `🫧 Moment recorded... signal preserved by ${senderName} → ${clipUrl}`
    ];

    client.say(channel, messages[Math.floor(Math.random() * messages.length)]);
}

async function followAgeCommand(client, channel, userId, senderName, msg) {
    try {
        let targetId = userId;
        let targetName = senderName;

        const parts = msg.split(' ');
        if (parts[1]) {
            targetName = parts[1].replace(/^@/, '');

            const userRes = await axios.get('https://api.twitch.tv/helix/users', {
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                },
                params: {login: targetName.toLowerCase()}
            });

            if (!userRes.data.data?.length) {
                client.say(channel, `Could not find user: ${targetName}`);
                return;
            }

            targetId = userRes.data.data[0].id;
            targetName = userRes.data.data[0].display_name;
        }

        const followageStr = await getFollowage(targetId, config);

        if (!followageStr) {
            client.say(channel, `${targetName} is not following yet or an error occurred.`);
        } else {
            client.say(channel, `${targetName} has been following for ${followageStr}!`);
        }
    } catch (err) {
        Logger.error(err);
        client.say(channel, `Sorry ${senderName}, I couldn't fetch the followage.`);
    }
}

async function shoutoutCommand(client, msg) {
    const parts = msg.trim().split(/\s+/);
    const users = parts.slice(1); // everything after "!so"

    if (users.length === 0) {
        client.say(config.CHANNEL_NAME, `Usage — !so [username] or !so [username1] [username2] ...`);
        return;
    }

    await shoutout(client, config, users);
}

//--------------------------------- TWITCH TEST COMMANDS ------------------------------------

function followTestCommand(client, senderName) {
    simulateFollow(client, config, senderName);
}

function raidTestCommand(client, senderName, viewers = 42) {
    simulateRaid(client, config, senderName, viewers);
}

function adBreakTestCommand(client, durationSeconds = 30, isAutomatic = true, requester = null) {
    simulateAdBreak(client, config, durationSeconds, isAutomatic, requester);
}


//--------------------------------- SSR & MUSIC COMMANDS ------------------------------------

// ------------------- SSR global cooldown -------------------
let ssrEnabled = false;

async function ssrCommand(client, channel, senderName, msg, isBroadcaster) {
    if (!ssrEnabled && !isBroadcaster) {
        client.say(channel, `⚠️ Song requests are currently closed ✧`);
        return;
    }

    const query = msg.slice('!sr'.length).trim();

    if (!query) {
        client.say(channel, `${senderName}... provide a song name or YouTube link ✧`);
        return;
    }

    const urlMatch = query.match(/(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

    const result = urlMatch
        ? await getSongByVideoId(urlMatch[1])
        : await searchSong(query);

    if (!result) {
        client.say(channel, `⚠️ Couldn't find "${query}"... try a different search ✧`);
        return;
    }

    if (result.tooLong) {
        client.say(channel, `⚠️ ${senderName}, that song is too long (${result.durationText})... max is 10 minutes ✧`);
        return;
    }

    await addSongToSSRQueue(result.videoId, result.title, senderName);

    client.say(channel, `✅ ${senderName}, queued: ${result.title} → https://music.youtube.com/watch?v=${result.videoId} 💾`);
}

async function skipCommand(client, channel) {
    await skipSong();
    client.say(channel, `⏭️ Skipping current song... ✧`);
}

async function qCommand(client, channel) {
    try {
        const queueText = await getQueueWithCurrent();
        client.say(channel, queueText);
    } catch (err) {
        Logger.error(`[ERROR] Failed to fetch queue: ${err.message}`);
        client.say(channel, 'Failed to fetch queue.');
    }
}

async function currentSongCommand(client, channel) {
    const song = await getCurrentSong();
    if (song) {
        client.say(channel, `🎶 ${song.artist} - ${song.title} 🎶`);
    } else {
        client.say(channel, "🎶 No song is currently playing. 🎶");
    }
}

function clearQCommand(client, channel) {
    clearQueue();
    client.say(channel, `🗑️ SR queue cleared ✧`);
}

function closeQCommand(client, channel) {
    ssrEnabled = false;
    clearQueue();
    client.say(channel, `🛑 Song requests closed and queue cleared ✧`);
}

function openQCommand(client, channel) {
    ssrEnabled = true;
    client.say(channel, `✅ Song requests are now open! Use !sr to request a song 🎶`);
}

//--------------------------------- MEDIA REQUESTS ------------------------------------

async function openMrCommand(client, channel, config) {
    mrEnabled = true;
    try {
        await setRewardPaused(config, config.MR_REDEEM_ID, false);
    } catch (err) {
        Logger.error(`[MediaRequest] failed to unpause reward: ${err.message}`);
    }
    client.say(channel, `✅ Media requests are now open! Redeem to have something played on stream 🎬`);
}

async function closeMrCommand(client, channel, config) {
    mrEnabled = false;
    try {
        await setRewardPaused(config, config.MR_REDEEM_ID, true);
    } catch (err) {
        Logger.error(`[MediaRequest] failed to pause reward: ${err.message}`);
    }
    client.say(channel, `🛑 Media requests are now closed ✧`);
}

//--------------------------------- GLOSSELS ------------------------------------

function getBalanceCommand(client, channel, userId, senderName) {
    const amount = retrieveGlossels(userId, senderName);

    client.say(channel, `${senderName} has acquired a total of ${amount} Glossels by maintaining their connection! 🫧`);
}

function getRankCommand(client, channel, userId, senderName) {
    const rank = getUserRank(userId);

    if (!rank) {
        client.say(channel, `${senderName}, you are not ranked yet!`);
        return;
    }

    client.say(channel, `${senderName} is ranked #${rank}, thank you for your continued support in keeping us online! 💾`);
}

function getTop5Command(client, channel) {
    const top = getTop5();

    if (top.length === 0) {
        client.say(channel, `No data available yet!`);
        return;
    }

    const formatted = top
        .map((u, i) => `#${i + 1} ${u.usrName} (${u.amount})`)
        .join(' | ');

    client.say(channel, `🫧 Glosso-Leaderboard: ${formatted}`);
}

//--------------------------------- ARG ------------------------------------

function argSystemCommand(client, channel, userId, senderName, tags, msg) {
    const parts = msg.trim().split(/\s+/);
    const sub = parts[1]?.toLowerCase();
    const args = parts.slice(2).join(' ') || null;

    if (!sub) {
        handleSys(client, channel);
        return true;
    }

    // terminal must be activated first
    // allow !system (no subcommand) through always so they can activate it
    if (!sysIsTerminalActive() && sub) {
        client.say(channel, `Terminal not active. Run !system to initialise.`);
        return;
    }

    switch (sub) {
        case 'help':
            handleSysHelp(client, channel);
            break;
        case 'ls' :
            handleSysLs(client, channel);
            break;
        case 'cwd':
            handleSysCwd(client, channel);
            break;
        case 'dir':
            handleSysDir(client, channel, args);
            break;
        case 'read':
            handleSysRead(client, channel, args);
            break;
        case 'probe':
            sysHandleProbe(client, channel, args);
            break;
        case 'connect':
            handleSysConnect(client, channel, userId, senderName);
            break;
        case 'ping':
            handleSysPing(client, channel);
            break;
        case 'handshake':
            if (handleCooldown(userId, senderName, 'handshake', tags, client, channel, 30)) return;
            handleSysHandshake(client, channel, userId, senderName, msg);
            break;
        default:
            client.say(channel, `Unknown subcommand — ${sub}. Run !system help.`);
    }
}

function argSystemAdminCommand(client, channel, userId, senderName, tags, msg) { //specifically for mods
    if (!sysIsTerminalActive()) {
        client.say(channel, `Terminal not active. Run !system to initialise.`);
        return true;
    }

    const parts = msg.trim().split(/\s+/);
    const action = parts[1]?.toLowerCase();
    const target = parts[2]?.toLowerCase();
    const arg1 = parts[3];
    const arg2 = parts[4];

    // !sysAdmin grant probe {port}
    if (action === 'grant' && target === 'probe') {
        const port = parseInt(arg1);
        if (isNaN(port)) {
            client.say(channel, `Usage — !sysAdmin grant probe [port]`);
            return true;
        }
        sysHandleProbe(client, channel, String(port));
        return true;
    }

    // !sysAdmin revoke probe {port}
    if (action === 'revoke' && target === 'probe') {
        const port = parseInt(arg1);
        if (isNaN(port)) {
            client.say(channel, `Usage — !sysAdmin revoke probe [port]`);
            return true;
        }
        unmarkPortFound(port);
        client.say(channel, `Port ${port} — lock restored. Probe state cleared.`);
        return true;
    }

    // !sysAdmin bump coherence {number}
    if (action === 'bump' && target === 'coherence') {
        const amount = parseInt(arg1);
        if (isNaN(amount)) {
            client.say(channel, `Usage — !sysAdmin bump coherence [amount]`);
            return true;
        }
        const newCoherence = sysAddCoherence(amount);
        client.say(channel, `Coherence bumped +${amount}%. Current: ${newCoherence}%`);
        return true;
    }

    // !sysAdmin reduce coherence {number}
    if (action === 'reduce' && target === 'coherence') {
        const amount = parseInt(arg1);
        if (isNaN(amount)) {
            client.say(channel, `Usage — !sysAdmin reduce coherence [amount]`);
            return true;
        }
        const newCoherence = sysRemoveCoherence(amount);
        client.say(channel, `Coherence reduced -${amount}%. Current: ${newCoherence}%`);
        return true;
    }

    // !sysAdmin grant glossels {number} {user}
    if (action === 'grant' && target === 'glossels') {
        const amount = parseInt(arg1);
        if (isNaN(amount) || amount <= 0) {
            client.say(channel, `Usage — !sysAdmin grant glossels [amount] [user]`);
            return true;
        }
        const targetUser = arg2?.replace(/^@/, '');

        if (targetUser?.toUpperCase() === 'SYSTEM') {
            const allIds = [...getUserMap().keys()];
            const affected = giveAll(allIds, amount);
            client.say(channel, `Glossels granted to SYSTEM — +${amount} each. ${affected} users affected.`);
            return true;
        }

        if (!targetUser) {
            client.say(channel, `Usage — !sysAdmin grant glossels [amount] [user]`);
            return true;
        }

        const user = getUserByName(targetUser);
        if (!user) {
            client.say(channel, `User "${targetUser}" not found.`);
            return true;
        }

        addGlossels(user.usrId, amount, user.usrName);
        client.say(channel, `Glossels granted to ${user.usrName} — +${amount}. New balance: ${retrieveGlossels(user.usrId, user.usrName)}.`);
        return true;
    }

    // !sysAdmin revoke glossels {number} {user}
    if (action === 'revoke' && target === 'glossels') {
        const amount = parseInt(arg1);
        if (isNaN(amount) || amount <= 0) {
            client.say(channel, `Usage — !sysAdmin revoke glossels [amount] [user]`);
            return true;
        }
        const targetUser = arg2?.replace(/^@/, '');

        if (targetUser?.toUpperCase() === 'SYSTEM') {
            const allIds = [...getUserMap().keys()];
            const affected = removeAll(allIds, amount);
            client.say(channel, `Glossels revoked from SYSTEM — -${amount} each. ${affected} users affected.`);
            return true;
        }

        if (!targetUser) {
            client.say(channel, `Usage — !sysAdmin revoke glossels [amount] [user]`);
            return true;
        }

        const user = getUserByName(targetUser);
        if (!user) {
            client.say(channel, `User "${targetUser}" not found.`);
            return true;
        }

        removeGlossels(user.usrId, amount, user.usrName);
        client.say(channel, `Glossels revoked from ${user.usrName} — -${amount}. New balance: ${retrieveGlossels(user.usrId, user.usrName)}.`);
        return true;
    }

    client.say(channel, `Unknown admin command. Use: grant/revoke probe | bump/reduce coherence | grant/revoke glossels`);
    return true;
}

//--------------------------------- HELPER ------------------------------------
function resetCommandState() {
    ssrEnabled = false;
    mrEnabled = false;
}


module.exports = {
    devCommand,
    discordCommand,
    socialCommand,
    raidCommand,
    backseatCommand,
    lurkCommand,
    tailCommand,
    fishCommand,
    hugCommand,


    clipCommand,
    followAgeCommand,
    shoutoutCommand,

    followTestCommand,
    raidTestCommand,
    adBreakTestCommand,

    ssrCommand,
    skipCommand,
    qCommand,
    currentSongCommand,

    clearQCommand,
    closeQCommand,
    openQCommand,
    getSsrEnabled,

    getMrEnabled,
    openMrCommand,
    closeMrCommand,

    getBalanceCommand,
    getRankCommand,
    getTop5Command,

    argSystemCommand,
    argSystemAdminCommand,

    resetCommandState,
    counterCommand,

    handleModeration
};
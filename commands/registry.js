const axios = require('axios');

const {config} = require('../config');


const {createClip} = require('../modules/clipping');
const {getFollowage} = require('../modules/followage');
const {startLurk, isLurking} = require('../modules/lurk_tracker');
const {simulateFollow, simulateRaid, simulateAdBreak} = require("../modules/testing_events");

const {clearQueue} = require('../modules/ssr-queue');
const {
    getCurrentSong,
    getQueueWithCurrent,
    searchSong,
    getSongByVideoId,
    addSongToSSRQueue,
    skipSong
} = require('../modules/pear-desktop-music');

const {retrieveGlossels, getUserRank, getTop5} = require('../modules/glossels');

const {
    handleSys, handleSysHelp, handleSysDir, handleSysRead
    , sysHandleProbe, handleSysConnect
    , handleSysPing, handleSysLs, sysAddCoherence, handleSysCwd,
    sysIsTerminalActive, sysResetSession
} = require('../ARG/modules/arg_main')


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

function ytCommand(client) {
    client.say(
        config.CHANNEL_NAME,
        `🔴 Fox has been reaching out to connections over on youtube too! If you're interested in supporting us over there (or just want a different place to watch the VODs) check it out! ${config.YT_LINK} 🎬`
    )
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
        console.error(err);
        client.say(channel, `Sorry ${senderName}, I couldn't fetch the followage.`);
    }
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

    const query = msg.slice('!ssr'.length).trim();

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

    if (!isBroadcaster) lastSSRTime = Date.now();

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
        console.error('[ERROR] Failed to fetch queue:', err.message);
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
    client.say(channel, `🗑️ SSR queue cleared ✧`);
}

function closeQCommand(client, channel) {
    ssrEnabled = false;
    clearQueue();
    client.say(channel, `🛑 Song requests closed and queue cleared ✧`);
}

function openQCommand(client, channel) {
    ssrEnabled = true;
    client.say(channel, `✅ Song requests are now open! Use !ssr to request a song 🎶`);
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
        default:
            client.say(channel, `Unknown subcommand — ${sub}. Run !system help.`);
    }
}

function argSystemAdminCommand(client, channel, userId, senderName, tags, msg) { //specifically for mods
    const parts = msg.trim().split(/\s+/);
    const sub = parts[1]?.toLowerCase();

    // !arg probe [port]
    if (sub === 'probe') {
        const port = parseInt(parts[2]);
        if (isNaN(port)) {
            client.say(channel, `Usage — !arg probe [port]`);
            return true;
        }
        sysHandleProbe(client, channel, parts[2]);
        return true;
    }

    // !arg coherence [amount]
    if (sub === 'coherence') {
        const amount = parseInt(parts[2]);
        if (isNaN(amount)) {
            client.say(channel, `Usage — !arg coherence [amount]`);
            return true;
        }
        const newCoherence = sysAddCoherence(amount);
        client.say(channel, `Coherence manually adjusted. Current: ${newCoherence}%`);
        return true;
    }

    // !arg reset
    if (sub === 'reset') {
        sysResetSession();
        client.say(channel, `ARG event state reset. Starting fresh.`);
        return true;
    }

    return false;
}


module.exports = {
    devCommand,
    discordCommand,
    ytCommand,
    raidCommand,
    backseatCommand,
    lurkCommand,
    tailCommand,


    clipCommand,
    followAgeCommand,

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

    getBalanceCommand,
    getRankCommand,
    getTop5Command,

    argSystemCommand,
    argSystemAdminCommand
};
// modules/arg_main.js
// Self-contained ARG module, all state, filesystem, and command logic in one file

const fs = require('fs');
const path = require('path');
const {getIsOnline, onOnline, onOffline} = require('../../modules/helpers/stream-state');
const {Logger} = require('../../services');

const FS_ROOT = path.join(__dirname, '../_filesystem');
const STATE_PATH = path.join(__dirname, '../data/state.json');
const PORTS_PATH = path.join(__dirname, '../data/ports.json');
const FOUND_PORTS_PATH = path.join(__dirname, '../data/found_ports.json');

let terminalActivated = false;
let FullCoherenceAchieved = false;

//-------------------------------------------------------------------------------
// 1) JSON HELPERS
//-------------------------------------------------------------------------------

function readJSON(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        Logger.error(`[ARG] Failed to write ${filePath}: ${err.message}`);
    }
}

//-------------------------------------------------------------------------------
// 2) STATE: persists to JSON between streams
//-------------------------------------------------------------------------------

function getState() {
    return readJSON(STATE_PATH) ?? {
        coherence: 23,
        lastActivity: null,
        bitRotRate: 0.5
    };
}

function sysGetCoherence() {
    return getState().coherence;
}

function sysAddCoherence(amount) {
    const state = getState();
    state.coherence = Math.min(100, state.coherence + amount);
    state.lastActivity = new Date().toISOString();
    writeJSON(STATE_PATH, state);
    return state.coherence;
}

function sysRemoveCoherence(amount) {
    const state = getState();
    state.coherence = Math.max(0, state.coherence - amount);
    state.lastActivity = new Date().toISOString();
    writeJSON(STATE_PATH, state);
    return state.coherence;
}

function applyBitRot() {
    const state = getState();
    if (!state.lastActivity) return null;

    const hoursSince = (Date.now() - new Date(state.lastActivity)) / (1000 * 60 * 60);
    const decay = Math.floor(hoursSince * (state.bitRotRate ?? 0.5));
    if (decay <= 0) return null;

    state.coherence = Math.max(10, state.coherence - decay);
    state.lastActivity = new Date().toISOString();
    writeJSON(STATE_PATH, state);

    return {decay, newCoherence: state.coherence};
}

//-------------------------------------------------------------------------------
// 3) PORTS: reads fresh on every probe
//-------------------------------------------------------------------------------

function getPorts() {
    const ports = readJSON(PORTS_PATH);
    if (!ports) Logger.error('[ARG] ports.json could not be read, check for syntax errors.');
    return ports;
}

function getFoundPorts() {
    return readJSON(FOUND_PORTS_PATH) ?? {probed: {}};
}

function markPortFound(port) {
    const data = getFoundPorts();
    data.probed[port] = new Date().toISOString();
    writeJSON(FOUND_PORTS_PATH, data);
}

function wasPortFound(port) {
    return !!getFoundPorts().probed?.[port];
}

function unmarkPortFound(port) {
    const data = getFoundPorts();
    if (data.probed?.[port]) {
        delete data.probed[port];
        writeJSON(FOUND_PORTS_PATH, data);
    }
    sysProbedPorts.delete(port);
}

//-------------------------------------------------------------------------------
// 4) SESSION STATE: resets each stream, lives in memory only
//-------------------------------------------------------------------------------

const sysConnectedUsers = new Map(); // userId mapped to username
const sysProbedPorts = new Set();
let cwd = '/';

//-------------------------------------------------------------------------------
// 5) HELPER FUNCTIONS
//-------------------------------------------------------------------------------

function staggerSay(client, channel, messages, delay = 1500) {
    messages.forEach((msg, i) => {
        setTimeout(() => {
            const safe = msg.startsWith('/') || msg.startsWith('!') ? `>${msg}` : msg;
            client.say(channel, safe);
        }, i * delay);
    });
}

function sysLockedResponse(client, channel) {
    const responses = [
        `Command not recognised. Run !system help.`,
        `Access denied. That isn't available yet.`,
        `Unknown input. The system isn't ready for that.`,
        `Nothing returned. Keep exploring.`
    ];
    client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
}

function getAbsolutePath(inputPath) {
    if (!inputPath || inputPath === '/') return FS_ROOT;
    const clean = inputPath.replace(/^\//, '').toLowerCase().trim();
    return path.join(FS_ROOT, clean);
}

function getCwdAbsolute() {
    return getAbsolutePath(cwd);
}

function isDirAccessible(dirPath, coherence) {
    const meta = readJSON(path.join(dirPath, '_dir_meta.json'));
    if (!meta) return true;
    if (meta.lockedBelowCoherence && coherence < meta.lockedBelowCoherence) return false;
    return true;
}

function getDirLockedMessage(dirPath) {
    const meta = readJSON(path.join(dirPath, '_dir_meta.json'));
    const msg = meta?.lockedMessage ?? `Directory inaccessible. Coherence insufficient.`;
    return msg.startsWith('/') || msg.startsWith('!') ? `>${msg}` : msg;
}

function isEventUnlocked(eventName) {
    if (!eventName) return true;
    const ports = getPorts();
    if (!ports) return false;
    return Object.keys(ports).some(portNum =>
        ports[portNum].label === eventName && wasPortFound(parseInt(portNum))
    );
}

function isFileAccessible(file, coherence) {
    if (file.unlockedAtCoherence && coherence < file.unlockedAtCoherence) return false;
    if (file.unlockedByEvent && !isEventUnlocked(file.unlockedByEvent)) return false;
    return true;
}

function rewardConnectedUsers(client, channel, amount, reason) {
    const {addGlossels} = require('../../modules/functions/glossels');
    for (const [userId, username] of sysConnectedUsers) {
        addGlossels(userId, amount, username);
    }
    Logger.log(`[ARG] Rewarded ${sysConnectedUsers.size} users ${amount} Glossels, ${reason}`);
    if (sysConnectedUsers.size > 0) {
        client.say(channel, `${sysConnectedUsers.size} connection${sysConnectedUsers.size === 1 ? '' : 's'} rewarded ${amount} Glossels, ${reason}.`);
    }
}

//-------------------------------------------------------------------------------
// 7) PORT PROBE LOGIC
//-------------------------------------------------------------------------------

function sysHandleProbe(client, channel, portInput) {
    if (!portInput) {
        client.say(channel, `Specify a port. Usage: !system probe [port], example: !system probe 4096`);
        return;
    }

    const port = parseInt(portInput);

    if (isNaN(port)) {
        client.say(channel, `Invalid port, ${portInput}. Provide a numeric port.`);
        return;
    }

    // read ports fresh every probe
    const ports = getPorts();
    if (!ports) {
        client.say(channel, `Port probe failed. System error, check logs.`);
        return;
    }

    // already probed, use port's unique already probed message
    if (sysProbedPorts.has(port) || wasPortFound(port)) {
        const alreadyMsg = ports?.[port]?.alreadyProbedMessage
            ?? `Port ${port}, already recovered. Signal stable.`;
        client.say(channel, alreadyMsg);
        return;
    }

    // not in ports at all, dead signal, don't record
    if (!ports[port]) {
        const responses = [
            `Port ${port}, no response. Dead signal.`,
            `Port ${port}, endpoint unreachable.`,
            `Port ${port}, nothing there. Or nothing left.`,
            `Port ${port}, probe returned empty. Keep looking.`
        ];
        client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
        return;
    }

    const unlock = ports[port];

    // record in both memory and persistent storage for all port types
    sysProbedPorts.add(port);
    markPortFound(port);

    // lore type, fire announce but no unlock
    if (unlock.type === 'lore') {
        staggerSay(client, channel, unlock.announce, 1800);
        return;
    }

    // valid unlock port, fire unlock and reward
    const typeMap = {
        command: 'commands',
        daemon_module: 'daemonModules',
        discovery: 'discoveries'
    };

    // write unlock to unlocked_features if needed
    // keeping this lightweight, just log it, actual feature checks
    // happen in bot_response_modules via sysIsDaemonModuleUnlocked
    Logger.log(`[ARG] Port ${port} unlocked, type: ${unlock.type} label: ${unlock.label}`);

    rewardConnectedUsers(client, channel, 64, `port ${port} discovered`);
    staggerSay(client, channel, unlock.announce, 2000);
}

//-------------------------------------------------------------------------------
// 8) !system COMMAND HANDLERS
//-------------------------------------------------------------------------------

function handleSys(client, channel) {
    if (!terminalActivated) {
        terminalActivated = true;
        staggerSay(client, channel, [
            `AETHER-OS terminal activated.`,
            `Run !system help to see available commands.`
        ]);
    } else {
        client.say(channel, `AETHER-OS terminal currently active. Run !system help to see available commands.`);
    }
}

function handleSysHelp(client, channel) {
    const commands = [
        '!system help',
        '!system dir',
        '!system ls',
        '!system read',
        '!system cwd',
        '!system probe',
        '!system connect',
        '!system ping',
        '!system cache',
        '!system balance',
        '!system rank',
        '!system top',
        '!system handshake <amount>',
        '!system handshake <amount> <user>'
    ];
    client.say(channel, `SYSTEM HELP, Available: ${commands.join(' | ')}`);
}

function handleSysCwd(client, channel) {
    client.say(channel, `Current directory, ${cwd}`);
}

function handleSysDir(client, channel, userPath) {
    if (!userPath) {
        client.say(channel, `Specify a directory. Usage: !system dir [path], example: !system dir /boot`);
        return;
    }

    const coherence = sysGetCoherence();
    const targetPath = getAbsolutePath(userPath);

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        client.say(channel, `./${userPath}, directory not found. Current directory unchanged.`);
        return;
    }

    if (!isDirAccessible(targetPath, coherence)) {
        client.say(channel, getDirLockedMessage(targetPath));
        return;
    }

    cwd = '/' + userPath.replace(/^\//, '').toLowerCase().trim();
    client.say(channel, `moved to ${cwd}`);
}

function handleSysLs(client, channel) {
    const coherence = sysGetCoherence();
    const cwdPath = getCwdAbsolute();

    if (!fs.existsSync(cwdPath)) {
        client.say(channel, `current directory no longer accessible. Run !system dir to navigate.`);
        return;
    }

    const entries = fs.readdirSync(cwdPath);
    const visible = [];
    const locked = [];

    for (const entry of entries) {
        if (entry === '_dir_meta.json') continue;
        const entryPath = path.join(cwdPath, entry);
        const isDir = fs.statSync(entryPath).isDirectory();

        if (isDir) {
            isDirAccessible(entryPath, coherence)
                ? visible.push(`/${entry}/`)
                : locked.push(`/${entry}/ [RESTRICTED]`);
        } else if (entry.endsWith('.json')) {
            const file = readJSON(entryPath);
            if (!file) continue;
            if (!isFileAccessible(file, coherence)) continue;
            else if (file.corrupted) {
                visible.push(`${file.filename} [CORRUPTED]`);
            } else {
                visible.push(file.filename);
            }
        }
    }

    const all = [...visible, ...locked];

    if (all.length === 0) {
        client.say(channel, `${cwd}, empty or fully inaccessible.`);
        return;
    }

    staggerSay(client, channel, [
        `${cwd}, ${all.length} entr${all.length === 1 ? 'y' : 'ies'} found.`,
        all.join(' | ')
    ]);
}

function handleSysRead(client, channel, userInput) {
    if (!userInput) {
        client.say(channel, `Specify a file. Usage: !system read [file], example: !system read readme.txt`);
        return;
    }

    const coherence = sysGetCoherence();
    const clean = userInput.replace(/^\//, '').toLowerCase().trim();
    const parts = clean.split('/');

    let jsonFile;

    if (parts.length > 1) {
        const fileName = parts[parts.length - 1].replace(/\.[^/.]+$/, '');
        jsonFile = path.join(FS_ROOT, ...parts.slice(0, -1), `${fileName}.json`);
    } else {
        const fileName = clean.replace(/\.[^/.]+$/, '');
        jsonFile = path.join(getCwdAbsolute(), `${fileName}.json`);
    }

    if (!fs.existsSync(jsonFile)) {
        client.say(channel, `File not found, ${userInput}. Run !system ls to check available files.`);
        return;
    }

    const file = readJSON(jsonFile);
    if (!file) {
        client.say(channel, `Read error, ${userInput} could not be parsed.`);
        return;
    }

    if (file.unlockedAtCoherence && coherence < file.unlockedAtCoherence) {
        client.say(channel,
            `${file.filename}, access denied. ` +
            `Coherence insufficient. Required: ${file.unlockedAtCoherence}% | Current: ${coherence}%`
        );
        return;
    }

    if (!isFileAccessible(file, coherence)) {
        client.say(channel, file.lockedMessage?.[0] ?? `${file.filename}, not accessible yet.`);
        return;
    }

    if (file.corrupted && coherence < 60) {
        if (file.corruptedContent?.length) {
            staggerSay(client, channel, [
                `${file.filename}, signal degraded. Partial recovery only.`,
                ...file.corruptedContent
            ], 1200);
        } else {
            client.say(channel, `${file.filename}, corrupted. Cannot render.`);
        }
        return;
    }

    const lines = (file.content ?? []).map(line =>
        line.replace('{coherence}', coherence)
    );

    staggerSay(client, channel, [
        `${file.filename}, rendering.`,
        ...lines.map(line => line.startsWith('/') || line.startsWith('!') ? `· ${line}` : line)
    ]);
}

function handleSysConnect(client, channel, userId, username) {
    const {checkin} = require('../../modules/functions/glossels');
    const reward = checkin(userId, username);

    if (reward === null) {
        client.say(channel, `${username}, you've already checked in today. Signal already logged. 🫧`);
        return;
    }

    // also register for community rewards if not already tracked
    if (!sysConnectedUsers.has(userId)) {
        sysConnectedUsers.set(userId, username);
    }

    client.say(channel, `${username}, connection maintained. ${reward} Glossels retrieved. Thank you for keeping the signal alive. 🫧`);
}

function handleSysPing(client, channel) {
    const coherence = sysGetCoherence();

    if (coherence >= 100 || FullCoherenceAchieved) {
        client.say(channel, 'PING - system already fully restored.');
        return;
    }

    const newCoherence = sysAddCoherence(2);

    if (newCoherence >= 100) {
        FullCoherenceAchieved = true;
        staggerSay(client, channel, [
            `>> COHERENCE: 100%`,
            `>> BIT-ROT: ABSENT`,
            `>> GLOSSO-SPHERE RESOLUTION: MAXIMUM`,
            `SURFACES NOMINAL. AUDIO NOMINAL. SIGNAL NOMINAL.`,
            `ALL PORTS STABLE`,
            `>> PROXY ENVIRONMENT OPTIMAL. UPTIME SECURED.`
        ], 1500);
        return;
    }

    const tier = newCoherence >= 70 ? 'high' : newCoherence >= 40 ? 'mid' : 'low';
    const thresholds = [40, 50, 55, 60, 70, 80];
    const next = thresholds.find(t => t > newCoherence);
    const nextHint = next ? ` Next archive threshold at ${next}%.` : '';

    const pool = {
        low: [
            `PING, coherence: ${newCoherence}%.${nextHint} Signal degraded. Bit-rot accumulating.`,
            `PING, coherence: ${newCoherence}%.${nextHint} System fragmented. Input required.`,
            `PING, coherence: ${newCoherence}%.${nextHint} Holding. Barely. Keep pinging.`
        ],
        mid: [
            `PING, coherence: ${newCoherence}%.${nextHint} Partial recovery detected. Continuing.`,
            `PING, coherence: ${newCoherence}%.${nextHint} Signal stabilising. Do not stop.`,
            `PING, coherence: ${newCoherence}%.${nextHint} Cache refreshing. Connection appreciated.`
        ],
        high: [
            `PING, coherence: ${newCoherence}%.${nextHint} Strong signal. Almost there.`,
            `PING, coherence: ${newCoherence}%.${nextHint} This is what it should feel like.`
        ]
    }[tier];

    client.say(channel, pool[Math.floor(Math.random() * pool.length)]);
}

function handleSysCache(client, channel) {
    const {getCacheBalance} = require('../../modules/functions/glossels');
    const balance = getCacheBalance();
    client.say(channel, `Network Cache: ${balance} Glossels buffered. !system handshake to retrieve.`);
}

//-------------------------------------------------------------------------------
// 8B) !system handshake: NETWORK GAMBLE / TRANSFER
//-------------------------------------------------------------------------------

const HANDSHAKE_OUTCOMES = [
    {
        type: 'accepted', weight: 35, multiplier: 2, messages: [
            'Node accepted {user} handshake. Packets returned doubled.',
            'Connection established. Node amplified {user} signal. +{amount} Glossels.',
            'Handshake successful. Network node returned {user} data with interest.'
        ]
    },
    {
        type: 'unstable', weight: 30, multiplier: 1, messages: [
            'Signal unstable. Packets retained, no change.',
            'Node acknowledged but refused to route. Glossels unchanged.',
            'Connection flickered. Data returned as sent. No loss, no gain.'
        ]
    },
    {
        type: 'rejected', weight: 25, multiplier: 0, messages: [
            'Node rejected transmission. Packets corrupted. -{amount} Glossels.',
            'Handshake failed. Network firewall severed {user} connection. Data lost.',
            'Unknown node dropped {user} signal. Glossels absorbed into the void.'
        ]
    },
    {
        type: 'amplified', weight: 8, multiplier: 3, messages: [
            '>> UNKNOWN NODE AMPLIFYING SIGNAL. 3x recovery. +{amount} Glossels.',
            '>> CRITICAL: Node running unknown protocol. Packets tripled. This should not be possible.',
            '>> ANOMALY DETECTED. Node returned 3x {user} original transmission.'
        ]
    },
    {
        type: 'captured', weight: 2, multiplier: -0.5, messages: [
            'Node partially captured {user} packets. Half recovered. -{amount} Glossels.',
            'WARNING: Intercepted mid-transfer. Partial data salvage. {user} lost more than {user} kept.',
            'Hostile node detected. Packet capture partial. What remains has been returned.'
        ]
    },
    {
        type: 'drained', weight: 0.5, multiplier: 1, messages: [
            '>> NETWORK CACHE DRAINED. All buffered packets recovered. +{cache} Glossels.',
            '>> CENTRAL CACHE SIPHONED. {user} retrieved every lost packet from the buffer. +{cache} Glossels.',
            '>> CACHE BREACH. Buffered data extracted. {user} recovered {cache} Glossels from the network cache.'
        ]
    }
];

function rollHandshakeOutcome() {
    const totalWeight = HANDSHAKE_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
    let random = Math.random() * totalWeight;

    for (const outcome of HANDSHAKE_OUTCOMES) {
        if (random < outcome.weight) return outcome;
        random -= outcome.weight;
    }

    return HANDSHAKE_OUTCOMES[0];
}

function handleSysHandshake(client, channel, userId, senderName, msg) {
    const {
        addGlossels,
        removeGlossels,
        retrieveGlossels,
        getUserByName,
        giveGlossels,
        addToCache,
        drainCache,
        getCacheBalance
    } = require('../../modules/functions/glossels');

    const parts = msg.trim().split(/\s+/);
    const amount = parseInt(parts[2], 10);

    if (!amount || amount <= 0) {
        client.say(channel, `Usage: !system handshake <amount>, send Glossels into an unknown network node.`);
        return;
    }

    const currentBalance = retrieveGlossels(userId, senderName);

    if (currentBalance < amount) {
        client.say(channel, `${senderName}, insufficient Glossels. Balance: ${currentBalance} Glossels.`);
        return;
    }

    // Transfer mode: !system handshake <amount> <user>
    const rawTarget = (parts[3] ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (rawTarget) {
        const targetUser = getUserByName(rawTarget);

        if (!targetUser) {
            client.say(channel, `User "${rawTarget}" not found in the network.`);
            return;
        }

        const result = giveGlossels(userId, targetUser.usrId, amount);
        if (!result.success) {
            client.say(channel, `Transfer failed, ${result.reason}.`);
            return;
        }

        staggerSay(client, channel, [
            `>> DIRECT TRANSFER INITIATED`,
            `${senderName} -> ${targetUser.usrName}: ${amount} Glossels`,
            `Transfer complete. Sender Balance: ${result.newSenderBalance} Glossels. Receiver Balance: ${result.newReceiverBalance} Glossels.`
        ]);
        return;
    }

    // Solo gamble mode
    const outcome = rollHandshakeOutcome();
    const msgTemplate = outcome.messages[Math.floor(Math.random() * outcome.messages.length)];

    let displayAmount;
    let cacheGain = 0;

    if (outcome.type === 'drained') {
        const cacheBalance = drainCache();
        addGlossels(userId, amount + cacheBalance, senderName);
        displayAmount = amount + cacheBalance;
        cacheGain = cacheBalance;
    } else if (outcome.type === 'captured') {
        const lost = Math.ceil(amount * 0.5);
        removeGlossels(userId, lost, senderName);
        addToCache(lost);
        displayAmount = lost;
    } else if (outcome.multiplier > 1) {
        const returnAmount = Math.floor(amount * outcome.multiplier);
        removeGlossels(userId, amount, senderName);
        addGlossels(userId, returnAmount, senderName);
        displayAmount = returnAmount - amount;
    } else if (outcome.multiplier === 0) {
        removeGlossels(userId, amount, senderName);
        addToCache(amount);
        displayAmount = amount;
    }

    const newBalance = retrieveGlossels(userId, senderName);
    const flavor = msgTemplate
        .replace(/{amount}/g, displayAmount)
        .replace(/{user}/g, senderName)
        .replace(/{cache}/g, cacheGain);

    const lines = [
        `>> NETWORK HANDSHAKE, SENDING ${amount} GLOSSELS`,
        flavor
    ];

    if (outcome.type === 'rejected' || outcome.type === 'captured') {
        const cacheBalance = getCacheBalance();
        lines.push(`Network cache absorbing. ${cacheBalance} Glossels buffered.`);
    }

    lines.push(`${senderName} Balance: ${newBalance} Glossels.`);

    staggerSay(client, channel, lines);
}

//-------------------------------------------------------------------------------
// 9) EVENT STATE HELPERS
//-------------------------------------------------------------------------------

function sysIsTerminalActive() {
    return terminalActivated;
}

function sysResetSession() {
    sysConnectedUsers.clear();
    sysProbedPorts.clear();
    cwd = '/';
    terminalActivated = false;
}

//-------------------------------------------------------------------------------
// 10) STARTUP & EXPORTS
//-------------------------------------------------------------------------------

function startARGElements(client, config) {
    const {loadCurrencySystem} = require('../../modules/functions/glossels');
    loadCurrencySystem();

    const foundPorts = getFoundPorts();
    for (const port of Object.keys(foundPorts.probed ?? {})) {
        sysProbedPorts.add(parseInt(port));
    }

    onOffline(() => {
        Logger.log('[ARG] Stream went offline.');
    });

    onOnline(() => {
        const result = applyBitRot();
        if (result?.decay > 0) {
            setTimeout(() => {
                client.say(config.CHANNEL_NAME,
                    `System resumed. Bit-rot applied during downtime: -${result.decay}% coherence. Current: ${result.newCoherence}%.`
                );
            }, 5000);
        }
    });

    Logger.log('[ARG] System online. TA1LDA3M0N active.');
}

module.exports = {
    startARGElements,

    // system commands
    handleSys,
    handleSysHelp,
    handleSysCwd,
    handleSysDir,
    handleSysLs,
    handleSysRead,
    handleSysConnect,
    handleSysPing,
    handleSysCache,
    handleSysHandshake,
    sysHandleProbe,

    // state accessors
    sysGetCoherence,
    sysAddCoherence,
    sysRemoveCoherence,

    // response helpers
    sysLockedResponse,

    // connection tracker
    sysConnectedUsers,

    // ports
    getPorts,
    unmarkPortFound,

    // event state
    sysIsTerminalActive,
    sysResetSession
};
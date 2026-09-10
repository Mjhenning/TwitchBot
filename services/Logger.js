const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

let logStream = null;
let client = null;
let ownerDm = null;
let hooksInstalled = false;
let crashed = false;

function init(discordClient) {
    client = discordClient || null;
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const existing = fs.readdirSync(LOG_DIR).filter(f => f.startsWith(`bot-log-${today}`));
    const iteration = existing.length + 1;
    const fileName = `bot-log-${today}-${iteration}.txt`;

    logStream = fs.createWriteStream(path.join(LOG_DIR, fileName), { flags: 'a' });
    installProcessHooks();
}

// Capture crashes that would otherwise vanish to stderr, then exit so the process manager restarts.
function installProcessHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    process.on('uncaughtException', (err) => crash(`uncaughtException: ${err.stack || err}`));
    process.on('unhandledRejection', (reason) => crash(`unhandledRejection: ${reason?.stack || reason}`));
}

function crash(msg) {
    if (crashed) return;
    crashed = true;

    console.error(`[${new Date().toLocaleTimeString()}] [Logger] ${msg}`);
    if (logStream) {
        // Flush the trace to the daily log before exiting
        logStream.end(`[${new Date().toLocaleTimeString()}] [Logger] ${msg}\n`, () => process.exit(1));
    } else {
        process.exit(1);
    }
}

function log(msg, dm = false) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (logStream) logStream.write(line + '\n');
    console.log(line);
    if (dm) sendDm(msg);
}

function warn(msg) {
    log(`[WARN] ${msg}`);
}

function error(msg) {
    log(`[ERROR] ${msg}`);
}

async function sendDm(msg) {
    if (!client) return;

    try {
        if (!ownerDm) {
            const appInfo = await client.application.fetch();
            const owner = await client.users.fetch(appInfo.owner.id);
            ownerDm = await owner.createDM();
        }
        await ownerDm.send(msg);
    } catch (ex) {
        log(`[WARN] Failed to send log DM: ${ex.message}`);
        ownerDm = null;
    }
}

module.exports = {init, log, warn, error};

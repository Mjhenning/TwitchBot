const axios = require('axios');
const { config } = require('../../config');

async function vlcCommand(params = {}) {
    try {
        const res = await axios.get(`${config.VLC_HOST}/requests/status.xml`, {
            params,
            auth: {
                username: '',
                password: config.VLC_PASSWORD,
            },
        });

        return res.data;
    } catch (err) {
        throw new Error(`VLC command failed (${params.command ?? 'status'}): ${err.message}`);
    }
}

async function playFile(filePath) {
    await waitForVlc();

    await vlcCommand({ command: 'pl_empty' });
    await vlcCommand({
        command: 'in_enqueue',
        input: `file://${filePath}`,
    });
    await vlcCommand({ command: 'pl_play' });
}

async function stop() {
    await vlcCommand({ command: 'pl_stop' });

    // Tell VLC to quit.
    // systemd Restart=always will immediately start a fresh instance.
    try {
        await vlcCommand({
            command: 'in_play',
            input: 'vlc://quit',
        });
    } catch {
        // Expected — VLC exits before it can reply.
    }
}

async function getState() {
    const xml = await vlcCommand();
    const match = xml.match(/<state>(.*?)<\/state>/);
    return match ? match[1] : 'unknown';
}

async function waitForVlc(timeout = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        try {
            await getState();
            return;
        } catch {
            await new Promise(r => setTimeout(r, 250));
        }
    }

    throw new Error('VLC failed to restart.');
}

module.exports = {
    playFile,
    stop,
    getState,
};
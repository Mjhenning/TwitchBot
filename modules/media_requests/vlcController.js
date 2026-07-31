const axios = require('axios');
const {config} = require('../../config');

async function vlcCommand(params = {}) {
    try {
        const res = await axios.get(`${config.VLC_HOST}/requests/status.xml`, {
            params,
            auth: {username: '', password: config.VLC_PASSWORD},
        });
        return res.data;
    } catch (err) {
        throw new Error(`VLC command failed (${params.command ?? 'status'}): ${err.message}`);
    }
}

async function playFile(filePath) {
    await vlcCommand({command: 'pl_empty'});
    await vlcCommand({command: 'in_enqueue', input: `file://${filePath}`});
    await vlcCommand({command: 'pl_play'});
}

async function stop() {
    await vlcCommand({command: 'pl_stop'});
}

async function getState() {
    const xml = await vlcCommand();
    const match = xml.match(/<state>(.*?)<\/state>/);
    return match ? match[1] : 'unknown';
}

module.exports = {playFile, stop, getState};
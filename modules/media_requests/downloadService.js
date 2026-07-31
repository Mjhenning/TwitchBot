const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const {config} = require('../../config');
const execFileAsync = promisify(execFile);

function filePathFor(redemptionId) {
    return path.join(config.MEDIA_QUEUE_DIR, `${redemptionId}.mp4`);
}

async function downloadVideo(url, redemptionId) {
    await fs.mkdir(config.MEDIA_QUEUE_DIR, {recursive: true});
    const outPath = filePathFor(redemptionId);

    try {
        await execFileAsync('yt-dlp', [
            '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]',
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '-o', outPath,
            url,
        ], {timeout: 120000});
    } catch (err) {
        throw new Error(`download_failed: ${err.message}`);
    }

    return outPath;
}

async function deleteVideo(redemptionId) {
    await fs.rm(filePathFor(redemptionId), {force: true});
}

module.exports = {downloadVideo, deleteVideo};
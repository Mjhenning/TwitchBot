const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

const MAX_DURATION_SECONDS = 60; // 1 minute

class MetadataError extends Error {
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}

async function fetchMetadata(url) {
    let stdout;
    try {
        ({stdout} = await execFileAsync('yt-dlp', [
            '--dump-single-json', '--no-playlist', '--no-warnings', url,
        ], {timeout: 15000, maxBuffer: 10 * 1024 * 1024}));
    } catch {
        throw new MetadataError('extraction_failed');
    }

    let info;
    try {
        info = JSON.parse(stdout);
    } catch {
        throw new MetadataError('extraction_failed');
    }

    if (info.is_live) throw new MetadataError('live_stream');
    if (info.age_limit > 0) throw new MetadataError('age_restricted');
    if (info.availability && !['public', 'unlisted'].includes(info.availability)) {
        throw new MetadataError('unavailable');
    }
    if (!info.duration) throw new MetadataError('extraction_failed');
    if (info.duration > MAX_DURATION_SECONDS) throw new MetadataError('too_long');

    return {
        title: info.title,
        uploader: info.uploader,
        duration: info.duration,
        webpageUrl: info.webpage_url ?? url,
    };
}

module.exports = {fetchMetadata, MetadataError};
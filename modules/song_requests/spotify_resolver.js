// modules/song_requests/spotify_resolver.js
// Resolves Spotify track links to a title/artist query for YouTube search.
// Spotify can't be streamed through Pear, so a track link is only a reference.
const axios = require('axios');
const {Logger} = require('../../services');

const TRACK_ID_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([a-zA-Z0-9]{22})/;
const OTHER_SPOTIFY_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(album|playlist|episode|artist|show|user)\/|spotify:(?:album|playlist|episode|artist|show|user):)/;

// Returns {type:'track', id} for track links, {type:'other'} for albums/playlists, null otherwise
function parseSpotify(query) {
    const track = query.match(TRACK_ID_RE);
    if (track)
        return {type: 'track', id: track[1]};
    if (OTHER_SPOTIFY_RE.test(query))
        return {type: 'other'};
    return null;
}

// Public oEmbed endpoint, no API key needed
async function getTrackInfo(trackId) {
    const url = `https://open.spotify.com/track/${trackId}`;
    try {
        const res = await axios.get('https://open.spotify.com/oembed', {
            params: {url},
            timeout: 5000
        });
        const rawTitle = (res.data?.title || '').trim();
        let artist = (res.data?.author_name || '').trim();
        let title = rawTitle;

        // fall back to "Title - Artist" when oEmbed has no separate author
        if (!artist && rawTitle.includes(' - ')) {
            const idx = rawTitle.lastIndexOf(' - ');
            title = rawTitle.slice(0, idx).trim();
            artist = rawTitle.slice(idx + 3).trim();
        }

        if (!title)
            return null;

        // oEmbed for tracks omits the artist; scrape it from the track page meta
        if (!artist)
            artist = await fetchArtistFromPage(trackId);

        return {title, artist, query: `${title} ${artist}`.trim()};
    } catch (err) {
        Logger.error(`[SSR Spotify] Lookup failed for track ${trackId}: ${err.message}`);
        return null;
    }
}

// Best-effort artist scrape; the track page is server-rendered with this meta
async function fetchArtistFromPage(trackId) {
    try {
        const res = await axios.get(`https://open.spotify.com/track/${trackId}`, {
            timeout: 5000,
            headers: {'User-Agent': 'Mozilla/5.0'}
        });
        const match = String(res.data).match(/<meta\s+name="music:musician_description"\s+content="([^"]*)"/i);
        return match ? match[1].trim() : '';
    } catch (err) {
        Logger.warn(`[SSR Spotify] Artist scrape failed for track ${trackId}: ${err.message}`);
        return '';
    }
}

module.exports = {parseSpotify, getTrackInfo};

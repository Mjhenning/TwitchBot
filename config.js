// config.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ---------- Paths ----------
const BOT_REFRESH_PATH = path.join(__dirname, 'data', 'bot_refresh_token.json');
const BROADCASTER_REFRESH_PATH = path.join(__dirname, 'data', 'broadcaster_refresh_token.json');
const COUNTER_PATH = path.join(__dirname, 'data', 'counters.json');
const MOD_CONFIG_PATH = path.join(__dirname, 'data', 'moderation.json');

const PENDING_REDEMPTIONS_PATH = path.join(__dirname, 'data', 'pendingRedemptions.json');
const CURRENCY_FILE = path.join(__dirname, 'data', 'glossels_db.json');
const TIMED_COMMANDS_FILE = path.join(__dirname, 'data', 'timed_commands.json');

// ---------- Config object ----------
const config = {
    // ---------- Static info ----------
    BOT_NAME: 'TA1LDA3M0N',
    CHANNEL_NAME: 'F0XTA1L',
    CLIENT_ID: 'REDACTED_CLIENT_ID',
    CLIENT_SECRET: 'REDACTED_CLIENT_SECRET',

    DISCORD_LINK: 'https://discord.gg/PffjFkme3H',
    ITCH_LINK: 'https://mjhenning.itch.io/fish-face',
    YT_LINK: 'https://www.youtube.com/@f0xta1l-vt',

    // ---------- Pear Desktop ----------
    PEAR_HOST: 'http://192.168.1.71',
    PEAR_PORT: 26538,
    PEAR_ACCESS_TOKEN: null,
    PEAR_ID: 'YOUR_PEAR_AUTH_ID',

    // ---------- Google API ----------
    YOUTUBE_ACCESS_KEY: 'REDACTED_YOUTUBE_KEY',

    // ----------- OBS Websocket --------
    OBS_WS_URL: "ws://192.168.1.71:4455",
    OBS_WS_PASSWORD: "REDACTED_OBS_PASSWORD",


    // ---------- BOT AUTH ----------
    BOT_ACCESS_TOKEN: null,
    BOT_REFRESH_TOKEN: null,
    BOT_OAUTH_TOKEN: null,

    // ---------- BROADCASTER AUTH ----------
    BROADCASTER_ACCESS_TOKEN: null,
    BROADCASTER_REFRESH_TOKEN: null,
    BROADCASTER_OAUTH_TOKEN: null,

    // ---------- General ----------
    APP_TOKEN: null,
    BROADCASTER_ID: null,
    BOT_ID: null,

    // ---------- Redeems ----------
    MR_REDEEM_ID: '3312ef05-52a4-4724-ad50-5ff3992b95b6',
    MEDIA_QUEUE_DIR: '/home/mjhenning/MediaQueue',

    VLC_HOST: 'http://localhost:8080',
    VLC_PASSWORD: 'REDACTED_VLC_PASSWORD',

    OBS_WS_URL: 'ws://192.168.1.71:4455',
    OBS_SCENE_NAME: 'Main',
    OBS_SOURCE_NAME: 'Media_Playback',

    // ---------- Data ----------
    COUNTER_PATH,
    MOD_CONFIG_PATH,
    PENDING_REDEMPTIONS_PATH,
    CURRENCY_FILE,
    TIMED_COMMANDS_FILE,

    DEBUG: true
};

// ---------- Pear base ----------
config.getPearBaseUrl = function () {
    return `${this.PEAR_HOST}:${this.PEAR_PORT}/api/v1`;
};

//
// ========================
// TOKEN STORAGE HELPERS
// ========================
//

function loadToken(pathFile) {
    if (fs.existsSync(pathFile)) {
        return JSON.parse(fs.readFileSync(pathFile, 'utf8')).refresh_token;
    }
    return null;
}

function saveToken(pathFile, token) {
    fs.writeFileSync(
        pathFile,
        JSON.stringify({refresh_token: token}, null, 2)
    );
}

// ---------- Load tokens ----------
function loadTokens() {
    config.BOT_REFRESH_TOKEN = loadToken(BOT_REFRESH_PATH);
    config.BROADCASTER_REFRESH_TOKEN = loadToken(BROADCASTER_REFRESH_PATH);

    if (config.DEBUG) {
        console.log('[DEBUG] Loaded bot refresh:', config.BOT_REFRESH_TOKEN);
        console.log('[DEBUG] Loaded broadcaster refresh:', config.BROADCASTER_REFRESH_TOKEN);
    }
}

//
// ========================
// TWITCH AUTH
// ========================
//

async function getAppToken() {
    const res = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
            params: {
                client_id: config.CLIENT_ID,
                client_secret: config.CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        }
    );

    if (config.DEBUG) console.log('[DEBUG] APP_TOKEN fetched');
    return res.data.access_token;
}

async function refreshToken(refreshTokenValue) {
    const res = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
            params: {
                grant_type: 'refresh_token',
                refresh_token: refreshTokenValue,
                client_id: config.CLIENT_ID,
                client_secret: config.CLIENT_SECRET
            }
        }
    );

    return res.data;
}

//
// ---------- BOT REFRESH ----------
async function refreshBotToken() {
    if (!config.BOT_REFRESH_TOKEN) return;

    const data = await refreshToken(config.BOT_REFRESH_TOKEN);

    config.BOT_ACCESS_TOKEN = data.access_token;
    config.BOT_OAUTH_TOKEN = 'oauth:' + data.access_token;
    config.BOT_REFRESH_TOKEN = data.refresh_token;

    saveToken(BOT_REFRESH_PATH, data.refresh_token);

    if (config.DEBUG) console.log('[DEBUG] Bot token refreshed');
}

//
// ---------- BROADCASTER REFRESH ----------
async function refreshBroadcasterToken() {
    if (!config.BROADCASTER_REFRESH_TOKEN) return;

    const data = await refreshToken(config.BROADCASTER_REFRESH_TOKEN);

    config.BROADCASTER_ACCESS_TOKEN = data.access_token;
    config.BROADCASTER_OAUTH_TOKEN = 'oauth:' + data.access_token;
    config.BROADCASTER_REFRESH_TOKEN = data.refresh_token;

    saveToken(BROADCASTER_REFRESH_PATH, data.refresh_token);

    if (config.DEBUG) console.log('[DEBUG] Broadcaster token refreshed');
}

async function refreshAppToken() {
    config.APP_TOKEN = await getAppToken();
    if (config.DEBUG) console.log('[DEBUG] App token refreshed');
}

//
// ========================
// TOKEN RETRY WRAPPER
// ========================
//

async function withTokenRetry(apiCall, refreshFn = refreshBroadcasterToken) {
    try {
        return await apiCall();
    } catch (err) {
        const status = err.response?.status;
        const msg = err.response?.data?.message ?? err.message ?? '';

        if (status === 401 || msg.toLowerCase().includes('invalid oauth token')) {
            console.warn('[Auth] 401 detected — refreshing token and retrying...');
            await refreshFn();
            return await apiCall();
        }

        throw err;
    }
}


//
// ========================
// USER IDS
// ========================
//

async function fetchUserIds() {
    // Channel (broadcaster)
    const channel = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Client-ID': config.CLIENT_ID,
            'Authorization': `Bearer ${config.APP_TOKEN}`
        },
        params: {login: config.CHANNEL_NAME}
    });

    if (!channel.data.data.length) {
        console.error('[ERROR] Channel not found for login:', config.CHANNEL_NAME);
        return;
    }

    config.BROADCASTER_ID = channel.data.data[0].id;

    // Bot
    const bot = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Client-ID': config.CLIENT_ID,
            'Authorization': `Bearer ${config.APP_TOKEN}`
        },
        params: {login: config.BOT_NAME}
    });

    if (!bot.data.data.length) {
        console.error('[ERROR] Bot not found for login:', config.BOT_NAME);
        return;
    }

    config.BOT_ID = bot.data.data[0].id;

    if (config.DEBUG) {
        console.log('[DEBUG] BROADCASTER_ID:', config.BROADCASTER_ID);
        console.log('[DEBUG] BOT_ID:', config.BOT_ID);
    }
}

//
// ========================
// PEAR
// ========================
//

async function initPearToken() {
    if (!config.PEAR_ACCESS_TOKEN) {
        try {
            const res = await axios.post(
                `${config.PEAR_HOST}:${config.PEAR_PORT}/auth/${config.PEAR_ID}`,
                {},
                {timeout: 3000}  // ← give up after 3 seconds
            );
            config.PEAR_ACCESS_TOKEN = res.data.accessToken;
            if (config.DEBUG) console.log('[DEBUG] Pear token fetched');
        } catch (err) {
            console.warn('[WARN] Pear unavailable, SSR features disabled:', err.message);
        }
    }
}

//
// ========================
// INIT
// ========================
//

async function initTokens() {
    loadTokens();

    config.APP_TOKEN = await getAppToken();

    await refreshBotToken();
    await refreshBroadcasterToken();

    await fetchUserIds();
    await initPearToken();

    if (config.DEBUG) {
        console.log('[DEBUG] READY:', {
            BOT: !!config.BOT_ACCESS_TOKEN,
            BROADCASTER: !!config.BROADCASTER_ACCESS_TOKEN,
            BROADCASTER_ID: config.BROADCASTER_ID,
            BOT_ID: config.BOT_ID
        });
    }

    return config;
}

module.exports = {
    config,
    initTokens,
    initPearToken,
    refreshBroadcasterToken,
    refreshBotToken,
    refreshAppToken,
    withTokenRetry
};
// auth.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {config} = require('./config');

// ---------- Paths ----------
const BOT_REFRESH_PATH = path.join(__dirname, 'data', 'bot_refresh_token.json');
const BROADCASTER_REFRESH_PATH = path.join(__dirname, 'data', 'broadcaster_refresh_token.json');

// ========================
// TOKEN STORAGE HELPERS
// ========================

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

// ========================
// TWITCH AUTH
// ========================

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

// ========================
// TOKEN RETRY WRAPPER
// ========================

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

// ========================
// USER IDS
// ========================

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

// ========================
// PEAR
// ========================

async function initPearToken() {
    if (!config.PEAR_ACCESS_TOKEN) {
        try {
            const res = await axios.post(
                `${config.PEAR_HOST}:${config.PEAR_PORT}/auth/${config.PEAR_ID}`,
                {},
                {timeout: 3000}
            );
            config.PEAR_ACCESS_TOKEN = res.data.accessToken;
            if (config.DEBUG) console.log('[DEBUG] Pear token fetched');
        } catch (err) {
            console.warn('[WARN] Pear unavailable, SSR features disabled:', err.message);
        }
    }
}

// ========================
// INIT
// ========================

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
    initTokens,
    initPearToken,
    refreshBroadcasterToken,
    refreshBotToken,
    refreshAppToken,
    withTokenRetry
};

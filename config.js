// config.js
require('dotenv').config();
const path = require('path');

// ---------- Paths ----------
const COUNTER_PATH = path.join(__dirname, 'data', 'counters.json');
const MOD_CONFIG_PATH = path.join(__dirname, 'data', 'moderation.json');
const PENDING_REDEMPTIONS_PATH = path.join(__dirname, 'data', 'pendingRedemptions.json');
const CURRENCY_FILE = path.join(__dirname, 'data', 'user_data.json');
const TIMED_COMMANDS_FILE = path.join(__dirname, 'data', 'timed_commands.json');
const TIMER_FILE = path.join(__dirname, 'data', 'glossothon_timer.json');
// shared with the Discord bot; its Data/ folder holds the curated favourite list
const FAVOURITES_FILE = process.env.FAVOURITES_FILE || path.join(__dirname, '..', 'DiscordBot', 'Data', 'favourites.json');

// ---------- Config object ----------
const config = {
    // ---------- Static info ----------
    BOT_NAME: process.env.BOT_NAME,
    CHANNEL_NAME: process.env.CHANNEL_NAME,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,

    DISCORD_LINK: process.env.DISCORD_LINK,
    ITCH_LINK: process.env.ITCH_LINK,
    YT_LINK: process.env.YT_LINK,
    INSTA_LINK: process.env.INSTA_LINK,

    REWARD_REVIEW_CHANNEL: process.env.REWARD_REVIEW_CHANNEL,

    // ---------- Pear Desktop ----------
    PEAR_HOST: process.env.PEAR_HOST,
    PEAR_PORT: parseInt(process.env.PEAR_PORT, 10),
    PEAR_ACCESS_TOKEN: null,
    PEAR_ID: process.env.PEAR_ID,

    // ---------- Google API ----------
    YOUTUBE_ACCESS_KEY: process.env.YOUTUBE_ACCESS_KEY,

    // ---------- OBS WebSocket ----------
    OBS_WS_URL: process.env.OBS_WS_URL,
    OBS_WS_PASSWORD: process.env.OBS_WS_PASSWORD,
    OBS_SOURCE_NAME: process.env.OBS_SOURCE_NAME,

    // ---------- BOT AUTH (runtime) ----------
    BOT_ACCESS_TOKEN: null,
    BOT_REFRESH_TOKEN: null,
    BOT_OAUTH_TOKEN: null,

    // ---------- BROADCASTER AUTH (runtime) ----------
    BROADCASTER_ACCESS_TOKEN: null,
    BROADCASTER_REFRESH_TOKEN: null,
    BROADCASTER_OAUTH_TOKEN: null,

    // ---------- General (runtime) ----------
    APP_TOKEN: null,
    BROADCASTER_ID: null,
    BOT_ID: null,

    // ---------- Redeems ----------
    MR_REDEEM_ID: process.env.MR_REDEEM_ID,
    MR_MAX_DURATION_SECONDS: parseInt(process.env.MR_MAX_DURATION_SECONDS, 10) || 60, // cap on redeemable clip length in seconds
    MEDIA_QUEUE_DIR: process.env.MEDIA_QUEUE_DIR,
    GLOSSELS_REDEEM_ID: process.env.GLOSSELS_REDEEM_ID,

    VLC_HOST: process.env.VLC_HOST,
    VLC_PASSWORD: process.env.VLC_PASSWORD,

    // ---------- Overlay ----------
    OVERLAY_WS_PORT: process.env.OVERLAY_WS_PORT || 8420, // single hub port, all overlays

    // ---------- Glosso-thon Timer ----------
    TIMER_START_MINUTES: parseInt(process.env.TIMER_START_MINUTES, 10) || 60, // base countdown length in minutes
    TIMER_GIFT_MINUTES: parseInt(process.env.TIMER_GIFT_MINUTES, 10) || 6, // minutes added per gifted sub

    // ---------- Data ----------
    COUNTER_PATH,
    MOD_CONFIG_PATH,
    PENDING_REDEMPTIONS_PATH,
    CURRENCY_FILE,
    TIMED_COMMANDS_FILE,
    TIMER_FILE,
    FAVOURITES_FILE,

    DEBUG: process.env.DEBUG === 'true'
};

// ---------- Pear base ----------
config.getPearBaseUrl = function () {
    return `${this.PEAR_HOST}:${this.PEAR_PORT}/api/v1`;
};

module.exports = {config};

// modules/shield_system.js
const WebSocket = require('ws');
const axios = require('axios');
const {Logger} = require('../../services');
const {setOnline, setOffline} = require('./stream-state');

let shieldWs = null;  // ← save handle

function startShieldSystem(client, config) {
    const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
    shieldWs = ws;  // ← store it
    let sessionId = null;

    ws.on('open', async () => {
        Logger.log('[ShieldDaemon] Connected');
        await syncShieldState(config);
    });

    ws.on('message', async (data) => {
        const msg = JSON.parse(data);

        switch (msg.metadata?.message_type) {
            case 'session_welcome':
                sessionId = msg.payload.session.id;
                Logger.log('[ShieldDaemon] Session ready');
                await subscribe(sessionId, config);
                break;

            case 'notification':
                const type = msg.payload?.subscription?.type;

                if (type === 'stream.online') {
                    Logger.log('[ShieldDaemon] Stream online detected');
                    setOnline();
                    await disableShieldMode(config);
                    client.say(`#${config.CHANNEL_NAME}`, `🟢 Stream detected... lifting protection ✧`);
                }

                if (type === 'stream.offline') {
                    Logger.log('[ShieldDaemon] Stream offline detected');
                    setOffline();
                    await enableShieldMode(config);
                    const messages = [
                        `🛡️ Stream ended... protection protocols engaged ✧`,
                        `Shield Mode activated... system integrity preserved 💾`,
                        `Incoming silence detected... defensive systems online 🫧`,
                        `Stream offline... entering protected state ✨`
                    ];
                    client.say(`#${config.CHANNEL_NAME}`, messages[Math.floor(Math.random() * messages.length)]);
                }
                break;

            case 'session_keepalive':
                Logger.log('[ShieldDaemon] Keepalive');
                break;

            case 'session_reconnect':
                Logger.log('[ShieldDaemon] Reconnecting...');
                ws.removeAllListeners();
                ws.close();
                startShieldSystem(client, config);
                break;
        }
    });

    ws.on('close', () => Logger.log('[ShieldDaemon] Closed'));
    ws.on('error', (err) => Logger.error(`[ShieldDaemon] Error: ${err}`));
}

function stopShieldSystem() {
    if (shieldWs) {
        shieldWs.removeAllListeners();
        shieldWs.close();
        shieldWs = null;
    }
    Logger.log('[ShieldDaemon] Stopped');
}

async function subscribe(sessionId, config) {
    const headers = {
        'Client-ID': config.CLIENT_ID,
        'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
    };

    try {
        await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
            type: 'stream.online',
            version: '1',
            condition: {broadcaster_user_id: config.BROADCASTER_ID},
            transport: {method: 'websocket', session_id: sessionId}
        }, {headers});

        await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
            type: 'stream.offline',
            version: '1',
            condition: {broadcaster_user_id: config.BROADCASTER_ID},
            transport: {method: 'websocket', session_id: sessionId}
        }, {headers});

        Logger.log('[ShieldDaemon] Subscribed to stream.online & stream.offline');
    } catch (err) {
        Logger.error(`[ShieldDaemon] Subscription error: ${err.response?.data || err}`);
    }
}

async function syncShieldState(config) {
    try {
        const res = await axios.get('https://api.twitch.tv/helix/streams', {
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
            },
            params: {user_id: config.BROADCASTER_ID}
        });

        const isLive = res.data.data && res.data.data.length > 0;

        if (isLive) {
            Logger.log('[ShieldDaemon] Stream is LIVE on startup → disabling shield');
            setOnline();
            await disableShieldMode(config);
        } else {
            Logger.log('[ShieldDaemon] Stream is OFFLINE on startup → enabling shield');
            setOffline();
            await enableShieldMode(config);
        }

    } catch (err) {
        Logger.error(`[ShieldDaemon] Startup sync error: ${err.response?.data || err}`);
    }
}

async function enableShieldMode(config) {
    try {
        await axios.put(
            'https://api.twitch.tv/helix/moderation/shield_mode',
            null,
            {
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
                },
                params: {
                    broadcaster_id: config.BROADCASTER_ID,
                    moderator_id: config.BROADCASTER_ID,
                    is_active: true
                }
            }
        );
        Logger.log('[ShieldDaemon] Shield ENABLED');
    } catch (err) {
        Logger.error(`[ShieldDaemon] Enable error: ${err.response?.data || err}`);
    }
}

async function disableShieldMode(config) {
    try {
        await axios.put(
            'https://api.twitch.tv/helix/moderation/shield_mode',
            null,
            {
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`
                },
                params: {
                    broadcaster_id: config.BROADCASTER_ID,
                    moderator_id: config.BROADCASTER_ID,
                    is_active: false
                }
            }
        );
        Logger.log('[ShieldDaemon] Shield DISABLED');
    } catch (err) {
        Logger.error(`[ShieldDaemon] Disable error: ${err.response?.data || err}`);
    }
}

module.exports = {startShieldSystem, stopShieldSystem};
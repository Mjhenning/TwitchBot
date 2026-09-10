// modules/twitch_events.js
const WebSocket = require('ws');
const axios = require('axios');
const {Logger} = require('../../../services');

let _client = null;
let _ws = null;
let sessionId = null;
let stopped = false;

// Reconnect state
let reconnectUrl = null;     // set by session_reconnect
let reconnectTimer = null;
let reconnectAttempts = 0;

// Registry of subscriptions to create once session is ready.
// Each entry: { type, version, condition(config), handler(event, client, config) }
const subscriptionRegistry = [];

// Register a new EventSub subscription type.
// @param type    Twitch EventSub subscription type, e.g. 'channel.follow'
// @param version Subscription version, e.g. '2'
// @param condition (config) => { ...condition object }
// @param handler   (event, client, config) => void, called on notification
function registerSubscription(type, version, condition, handler) {
    subscriptionRegistry.push({type, version, condition, handler});
}

// Reconnect after an unexpected close, with exponential backoff capped at 60s.
function scheduleReconnect(client, config) {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 60000);
    reconnectAttempts++;
    Logger.log(`TwitchEvents: Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startEventSub(client, config);
    }, delay);
}

function handleEventSubMessage(msg, client, config) {
    switch (msg.metadata?.message_type) {
        case 'session_welcome': {
            // Same session id means we resumed on the reconnect_url, no resubscribe needed
            const resumed = msg.payload.session.id === sessionId;
            sessionId = msg.payload.session.id;
            reconnectUrl = null;       // reconnect notice consumed
            reconnectAttempts = 0;

            if (resumed) {
                Logger.log('TwitchEvents: EventSub session resumed');
            } else {
                Logger.log('TwitchEvents: Session ready, subscribing to all registered events...');
                subscribeAll(client, config);
            }
            break;
        }

        case 'notification': {
            const subType = msg.payload?.subscription?.type;
            const event = msg.payload?.event;
            const entry = subscriptionRegistry.find(s => s.type === subType);

            if (entry) {
                Logger.log(`TwitchEvents: Notification received for "${subType}"`);
                try {
                    entry.handler(event, client, config);
                } catch (err) {
                    Logger.error(`TwitchEvents: Handler error for "${subType}": ${err}`);
                }
            } else {
                Logger.warn(`TwitchEvents: No handler registered for "${subType}"`);
            }
            break;
        }

        case 'session_keepalive':
            Logger.log('TwitchEvents: EventSub keepalive');
            break;

        case 'session_reconnect':
            Logger.log('TwitchEvents: EventSub requested reconnect');
            if (!stopped) {
                reconnectUrl = msg.payload?.session?.reconnect_url || null;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (_ws) _ws.close();       // old socket close skips reconnect (ws !== _ws)
                startEventSub(client, config);
            }
            break;

        default:
            Logger.log(`TwitchEvents: Unhandled message type "${msg.metadata?.message_type}"`);
    }
}

async function subscribeAll(client, config) {
    if (!sessionId) {
        Logger.error('TwitchEvents: No session ID, cannot subscribe');
        return;
    }

    Logger.log(`TwitchEvents: Subscribing to ${subscriptionRegistry.length} EventSub subscriptions...`);

    for (const sub of subscriptionRegistry) {
        try {
            const conditionObj = sub.condition(config);
            Logger.log(
                `TwitchEvents: Creating subscription for "${sub.type}" (version ${sub.version}) with condition: ${JSON.stringify(conditionObj)}`
            );

            const response = await axios.post(
                'https://api.twitch.tv/helix/eventsub/subscriptions',
                {
                    type: sub.type,
                    version: sub.version,
                    condition: conditionObj,
                    transport: {
                        method: 'websocket',
                        session_id: sessionId
                    }
                },
                {
                    headers: {
                        'Client-ID': config.CLIENT_ID,
                        'Authorization': `Bearer ${config.BROADCASTER_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            Logger.log(`✓ TwitchEvents: Successfully subscribed to "${sub.type}"`);
        } catch (err) {
            Logger.error(
                `✗ TwitchEvents: Failed to subscribe to "${sub.type}": ${err.response?.data || err.message}`
            );
        }
    }

    Logger.log('TwitchEvents: EventSub subscription process completed');
}

async function startEventSub(client, config) {
    stopped = false;  // reset on each start
    _client = client;
    const url = reconnectUrl || 'wss://eventsub.wss.twitch.tv/ws';
    const ws = new WebSocket(url);
    _ws = ws;
    client._ws = ws;
    client._eventSubHandler = (msg) => handleEventSubMessage(msg, client, config);

    ws.on('open', () => Logger.log('TwitchEvents: EventSub connected'));
    ws.on('message', (data) => client._eventSubHandler(JSON.parse(data)));
    ws.on('close', () => {
        Logger.log('TwitchEvents: EventSub WebSocket closed');
        if (ws !== _ws) return;   // superseded by an intentional reconnect
        scheduleReconnect(client, config);
    });
    ws.on('error', (err) => Logger.error(`TwitchEvents: EventSub WebSocket error: ${err}`));
}

function stopEventSub() {
    stopped = true; // prevents reconnect handler from re-opening
    sessionId = null;
    reconnectUrl = null;
    reconnectAttempts = 0;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (_ws) {
        _ws.close();
        _ws = null;
    }
    if (_client) _client._ws = null;

    _client = null;
    Logger.log('TwitchEvents: Stopped');
}

module.exports = {startEventSub, stopEventSub, handleEventSubMessage, registerSubscription};
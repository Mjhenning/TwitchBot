// modules/twitch_events.js
const WebSocket = require('ws');
const axios = require('axios');

let sessionId = null;

// Registry of subscriptions to create once session is ready.
// Each entry: { type, version, condition(config), handler(event, client, config) }
const subscriptionRegistry = [];

/**
 * Register a new EventSub subscription type.
 *
 * @param {string}   type       - Twitch EventSub subscription type, e.g. 'channel.follow'
 * @param {string}   version    - Subscription version, e.g. '2'
 * @param {function} condition  - (config) => { ...condition object }
 * @param {function} handler    - (event, client, config) => void  — called on notification
 */
function registerSubscription(type, version, condition, handler) {
  subscriptionRegistry.push({ type, version, condition, handler });
}

function handleEventSubMessage(msg, client, config) {
  switch (msg.metadata?.message_type) {
    case 'session_welcome':
      sessionId = msg.payload.session.id;
      console.log('TwitchEvents: Session ready, subscribing to all registered events...');
      subscribeAll(client, config);
      break;

    case 'notification': {
      const subType = msg.payload?.subscription?.type;
      const event   = msg.payload?.event;
      const entry   = subscriptionRegistry.find(s => s.type === subType);

      if (entry) {
        console.log(`TwitchEvents: Notification received for "${subType}"`);
        try {
          entry.handler(event, client, config);
        } catch (err) {
          console.error(`TwitchEvents: Handler error for "${subType}":`, err);
        }
      } else {
        console.warn(`TwitchEvents: No handler registered for "${subType}"`);
      }
      break;
    }

    case 'session_keepalive':
      console.log('TwitchEvents: EventSub keepalive');
      break;

    case 'session_reconnect':
      console.log('TwitchEvents: EventSub requested reconnect');
      client._ws.close();
      startEventSub(client, config);
      break;

    default:
      console.log(`TwitchEvents: Unhandled message type "${msg.metadata?.message_type}"`);
  }
}

async function subscribeAll(client, config) {
  if (!sessionId) {
    console.error('TwitchEvents: No session ID — cannot subscribe');
    return;
  }

  for (const sub of subscriptionRegistry) {
    try {
      console.log(
          `TwitchEvents: Subscribing to "${sub.type}" with condition:`,
          JSON.stringify(sub.condition(config))
      );

      await axios.post(
          'https://api.twitch.tv/helix/eventsub/subscriptions',
          {
            type: sub.type,
            version: sub.version,
            condition: sub.condition(config),
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

      console.log(`TwitchEvents: Subscribed to "${sub.type}"`);
    } catch (err) {
      console.error(
          `TwitchEvents: Failed to subscribe to "${sub.type}":`,
          err.response?.data || err
      );
    }
  }
}

function getAuthToken(config, auth) {
  switch (auth) {
    case 'broadcaster':
      return config.BROADCASTER_ACCESS_TOKEN;
    case 'bot':
    default:
      return config.BOT_ACCESS_TOKEN;
  }
}

async function startEventSub(client, config) {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
  client._ws           = ws;
  client._eventSubHandler = (msg) => handleEventSubMessage(msg, client, config);

  ws.on('open',    ()    => console.log('TwitchEvents: EventSub connected'));
  ws.on('message', (data) => client._eventSubHandler(JSON.parse(data)));
  ws.on('close',   ()    => console.log('TwitchEvents: EventSub WebSocket closed'));
  ws.on('error',   (err) => console.error('TwitchEvents: EventSub WebSocket error:', err));
}

module.exports = { startEventSub, handleEventSubMessage, registerSubscription };
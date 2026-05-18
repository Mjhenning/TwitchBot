// bot.js
const tmi = require('tmi.js');
const { config, initTokens } = require('./config');
const { startShieldSystem } = require('./modules/shield_system');
const { setupChatCommands } = require('./commands/chat_integration');
const { startTimers } = require('./modules/timer');
const { startAdSchedulePoller } = require('./modules/ad_schedule_poller');
const { startARGElements } = require('./ARG/modules/arg_main');
//const { loadCurrencySystem} = require('./modules/glossels');

const { startEventSub } = require('./modules/twitch_events');
require('./data/twitch_events_handlers'); // registers all subscriptions before session starts

(async () => {
  // 1️⃣ Initialize all dynamic tokens (user OAuth, app token)
  const cfg = await initTokens(); // Tokens are ready in memory

  // 2️⃣ Create TMI.js client with fresh OAUTH_TOKEN
  const client = new tmi.Client({
    identity: {
      username: cfg.BOT_NAME,
      password: cfg.BOT_OAUTH_TOKEN
    },
    channels: [cfg.CHANNEL_NAME],
    connection: { reconnect: true },
    logger: {
      info: console.log,
      warn: console.warn,
      error: (msg) => {
        if (typeof msg === 'string' && msg.includes('No response from Twitch')) return;
        console.error(msg);
      }
    }
  });

  // 3️⃣ Connect to chat
  client.connect().catch(console.error);

  client.on('connected', (address, port) => {
    console.log(`Chat bot (${cfg.BOT_NAME}) connected on ${address}:${port}`);
  });
  

  // 4️⃣ Pass the same config with fresh tokens to modules
  // loadCurrencySystem()
  startShieldSystem(client, cfg);
  await startEventSub(client, cfg);
  startAdSchedulePoller(client, cfg);
  startTimers(client, cfg.CHANNEL_NAME);
  setupChatCommands(client, cfg);
  startARGElements(client, cfg);  
})();

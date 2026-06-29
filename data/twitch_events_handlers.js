// data/twitch_events_handlers.js
//
// This is where you define what happens for each Twitch EventSub event.
// To add a new subscription, call registerSubscription() with:
//   - The Twitch event type  (https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)
//   - The version string
//   - A condition factory:  (config) => { ...condition fields }
//   - A handler function:   (event, client, config) => void
//
// All registrations here are automatically subscribed when the EventSub
// session becomes ready — no changes needed in twitch_events.js.

const axios = require('axios');
const {registerSubscription} = require('../modules/twitch_events');
const {eventShoutout} = require('../modules/shoutout')

// ─── channel.follow ────────────────────────────────────────────────────────────
registerSubscription(
    'channel.follow',
    '2',
    (config) => ({
        broadcaster_user_id: config.BROADCASTER_ID,
        moderator_user_id: config.BROADCASTER_ID
    }),
    (event, client, config) => {
        const follower = event.user_name;
        console.log(`EventHandlers: ${follower} followed`);
        client.say(
            `#${config.CHANNEL_NAME}`,
            `${follower} has peered into the Glosso-Sphere and decided to stay!🫧`
        ).catch(err => console.error('EventHandlers: Follow message failed:', err));
    }
);

// ─── channel.raid ──────────────────────────────────────────────────────────────
registerSubscription(
    'channel.raid',
    '1',
    (config) => ({
        to_broadcaster_user_id: config.BROADCASTER_ID  // fires when someone raids YOU
    }),
    async (event, client, config) => {
        await eventShoutout(event, client, config)
    }
);

// ─── channel.ad_break.begin ────────────────────────────────────────────────────
registerSubscription(
    'channel.ad_break.begin',
    '1',
    (config) => ({
        broadcaster_user_id: config.BROADCASTER_ID
    }),
    (event, client, config) => {
        const duration = event.duration_seconds;
        const isAutomatic = event.is_automatic;
        const requester = event.requester_user_name; // null if automatic

        console.log(`EventHandlers: Ad break started — ${duration}s, automatic=${isAutomatic}`);

        const who = isAutomatic
            ? 'Automatic ad break'
            : `${requester} triggered an ad break`;

        client.say(
            `#${config.CHANNEL_NAME}`,
            `📡 Bitrot interference detected — ${who} for ${duration} seconds. Hold steady, the Glosso-Sphere will stabilize shortly 🫧`
        ).catch(err => console.error('EventHandlers: Ad break message failed:', err));
    }
);

// ─── Add more subscriptions below ──────────────────────────────────────────────
// registerSubscription(
//   'channel.channel_points_custom_reward_redemption.add',
//   '1',
//   (config) => ({ broadcaster_user_id: config.CHANNEL_ID }),
//   (event, client, config) => {
//     console.log(`${event.user_name} redeemed "${event.reward.title}"`);
//   }
// );
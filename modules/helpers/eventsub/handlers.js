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
const {registerSubscription} = require('./core');
const {Logger} = require('../../services');
const {eventShoutout} = require('../../functions/shoutout')
const {getIsOnline} = require('../stream-state');

let adEndTimer = null;

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
        Logger.log(`EventHandlers: ${follower} followed`);
        client.say(
            `#${config.CHANNEL_NAME}`,
            `${follower} has peered into the Glosso-Sphere and decided to stay!🫧`
        ).catch(err => Logger.error(`EventHandlers: Follow message failed: ${err}`));
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
        const requester = event.requester_user_name;

        Logger.log(`EventHandlers: Ad break started — ${duration}s, automatic=${isAutomatic}`);

        const who = isAutomatic
            ? 'Automatic ad break'
            : `${requester} triggered an ad break`;

        client.say(
            `#${config.CHANNEL_NAME}`,
            `📡 Bitrot interference detected — ${who} for ${duration} seconds. Hold steady, the Glosso-Sphere will stabilize shortly 🫧`
        ).catch(err => Logger.error(`EventHandlers: Ad break message failed: ${err}`));

        // Cancel any previous timer just in case.
        if (adEndTimer) {
            clearTimeout(adEndTimer);
        }

        // Send a welcome-back message when the ad should be over.
        adEndTimer = setTimeout(() => {

            adEndTimer = null;

            // Don't send if the stream ended.
            if (!getIsOnline())
                return;

            client.say(
                `#${config.CHANNEL_NAME}`,
                `🫧 Bitrot interference has cleared! The Glosso-Sphere has stabilized — welcome back, everyone! ✨`
            ).catch(err => Logger.error(`EventHandlers: Welcome back message failed: ${err}`));

        }, (duration + 1) * 1000); // 1 second buffer
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
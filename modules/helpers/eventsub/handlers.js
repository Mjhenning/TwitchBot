// data/twitch_events_handlers.js
//
// Registers all EventSub subscriptions for this project.
// Each registration supplies a type, version, condition factory,
// and a handler function: (event, client, config) => void.
//
// All registrations here are automatically subscribed when the EventSub
// session becomes ready, no changes needed in twitch_events.js.

const axios = require('axios');
const {registerSubscription} = require('./core');
const {Logger} = require('../../../services');
const {eventShoutout} = require('../../functions/shoutout')
const {getIsOnline} = require('../stream-state');
const {handleRedeemAdd, handleRedeemUpdate} = require('../twitchRedemption');
const {addGiftSubs, isActive} = require('../../overlays/timer_overlay');

let adEndTimer = null;

//---------------------channel.follow---------------------
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

//---------------------channel.raid---------------------
registerSubscription(
    'channel.raid',
    '1',
    (config) => ({
        to_broadcaster_user_id: config.BROADCASTER_ID  // fires when someone raids the channel
    }),
    async (event, client, config) => {
        await eventShoutout(event, client, config)
    }
);

//---------------------channel.ad_break.begin---------------------
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

        Logger.log(`EventHandlers: Ad break started, ${duration}s, automatic=${isAutomatic}`);

        const who = isAutomatic
            ? 'Automatic ad break'
            : `${requester} triggered an ad break`;

        client.say(
            `#${config.CHANNEL_NAME}`,
            `📡 Bitrot interference detected, ${who} for ${duration} seconds. Hold steady, the Glosso-Sphere will stabilize shortly 🫧`
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
                `🫧 Bitrot interference has cleared! The Glosso-Sphere has stabilized, welcome back, everyone! ✨`
            ).catch(err => Logger.error(`EventHandlers: Welcome back message failed: ${err}`));

        }, (duration + 1) * 1000); // 1 second buffer
    }
);

//---------------------channel.subscription.gift---------------------
// Every gift sub (single or community) extends the Glosso-thon timer. event.total
// is the number of subs in *this* gift, cumulative_total is the gifter's running
// count, so total is what we add. Requires the channel:read:subscriptions scope.
// The gifted count is always banked and logged (the goals overlay tracks it and
// this doubles as a gift-sub test before an event); time is only added, and the
// announcement only posted, while the timer system is active.
registerSubscription(
    'channel.subscription.gift',
    '1',
    (config) => ({
        broadcaster_user_id: config.BROADCASTER_ID
    }),
    (event, client, config) => {
        const count = event.total || 0;
        if (count <= 0) return;

        const giftMin = config.TIMER_GIFT_MINUTES || 6;
        const who = event.is_anonymous ? 'An anonymous gifter' : event.user_name;
        const st = addGiftSubs(count);

        if (!isActive()) {
            Logger.log(`EventHandlers: ${who} gifted ${count} sub(s) (timer inactive, not banked, subs unchanged)`);
            return;
        }

        Logger.log(`EventHandlers: ${who} gifted ${count} sub(s) (+${count * giftMin} min, total ${st.subs})`);

        client.say(
            `#${config.CHANNEL_NAME}`,
            `🎁 ${who} gifted ${count} sub${count === 1 ? '' : 's'}! +${count * giftMin} min added to the Glosso-thon timer 🫧`
        ).catch(err => Logger.error(`EventHandlers: Gift sub message failed: ${err}`));
    }
);

//---------------------channel.channel_points_custom_reward_redemption---------------------
// Single add/update pair routes every reward through the redemption dispatcher,
// which fans out to the module registered for each reward_id. Omitting reward_id
// subscribes to all rewards for the broadcaster.
registerSubscription(
    'channel.channel_points_custom_reward_redemption.add',
    '1',
    (config) => ({broadcaster_user_id: config.BROADCASTER_ID}),
    (event, client, config) => handleRedeemAdd(event, client, config)
);
registerSubscription(
    'channel.channel_points_custom_reward_redemption.update',
    '1',
    (config) => ({broadcaster_user_id: config.BROADCASTER_ID}),
    (event, client, config) => handleRedeemUpdate(event, client, config)
);

//---------------------ADD MORE SUBSCRIPTIONS BELOW---------------------
// For new channel point rewards, do NOT add subscriptions here. Create a module
// that calls registerReward() from '../twitchRedemption' at require-time instead.
// registerSubscription(
//   'channel.poll.begin',
//   '1',
//   (config) => ({ broadcaster_user_id: config.BROADCASTER_ID }),
//   (event, client, config) => { ... }
// );
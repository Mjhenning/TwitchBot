const axios = require("axios");

async function EventShoutout(event, client, config) {
    const raider = event.from_broadcaster_user_name;
    const raiderId = event.from_broadcaster_user_id;
    const viewers = event.viewers;

    console.log(`EventHandlers: ${raider} raided with ${viewers} viewers`);

    // 1. Chat message
    client.say(
        `#${config.CHANNEL_NAME}`,
        `🟢 Active network expanded: ${raider} arrived with ${viewers} connections! Welcome in, raiders, the Glosso-Sphere just got a little brighter ✨ Be sure to check out ${raider} and return the signal: https://www.twitch.tv/${raider} 🦊💬`
    ).catch(err => console.error('EventHandlers: Raid message failed:', err));

    // 2. Official Twitch /shoutout via Helix API
    try {
        await axios.post(
            'https://api.twitch.tv/helix/chat/shoutouts',
            null,   // no body — all params go in the query string
            {
                params: {
                    from_broadcaster_id: config.CHANNEL_ID,
                    to_broadcaster_id: raiderId,
                    moderator_id: config.BOT_ID
                },
                headers: {
                    'Client-ID': config.CLIENT_ID,
                    'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                }
            }
        );
        console.log(`EventHandlers: Shoutout sent for ${raider}`);
    } catch (err) {
        // 429 means Twitch's shoutout cooldown is active (2 min per channel, 60 min same target)
        if (err.response?.status === 429) {
            console.warn(`EventHandlers: Shoutout for ${raider} skipped — cooldown active`);
        } else {
            console.error('EventHandlers: Shoutout API error:', err.response?.data || err);
        }
    }
}

async function Shoutout(client, config, users) {

    const soPool = [
        `hey! go say hi to **{user}** 🦊💙 they were last streaming **{game}** — go give them some signal: {link}`,
        `connection detected: **{user}** stopped by! last seen playing **{game}**. go check them out: {link}`,
        `🦊 shoutout to **{user}**! catch their last stream of **{game}** here: {link}`
    ];
    
    
    if (users.length > 1) {

    } else {
        client.say(
            `#${config.CHANNEL_NAME}`,
            
        )
    }

}

module.exports = {EventShoutout};
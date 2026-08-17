const axios = require("axios");
const {refreshAppToken, refreshBotToken, withTokenRetry} = require('../../auth');

//SHOUTOUT HELPERS

async function getUsersByLogin(logins, config) {
    const params = new URLSearchParams();
    logins.forEach(login => params.append('login', login.replace(/^@/, '')));

    return withTokenRetry(async () => {
        const res = await axios.get('https://api.twitch.tv/helix/users', {
            params,
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.APP_TOKEN}`
            }
        });
        return res.data.data;
    }, refreshAppToken);
}

async function getChannelsByIds(ids, config) {
    const params = new URLSearchParams();
    ids.forEach(id => params.append('broadcaster_id', id));

    return withTokenRetry(async () => {
        const res = await axios.get('https://api.twitch.tv/helix/channels', {
            params,
            headers: {
                'Client-ID': config.CLIENT_ID,
                'Authorization': `Bearer ${config.APP_TOKEN}`
            }
        });
        return res.data.data;
    }, refreshAppToken);
}

async function getUsersAndGames(usernames, config) {
    const users = await getUsersByLogin(usernames, config);
    if (users.length === 0) return [];

    const channels = await getChannelsByIds(users.map(u => u.id), config);
    const gameById = new Map(channels.map(c => [c.broadcaster_id, c.game_name]));

    return users.map(u => ({
        id: u.id,
        user: u.display_name,
        game: gameById.get(u.id) || 'something mysterious',
        link: `https://www.twitch.tv/${u.login}`
    }));
}

async function sendTwitchShoutout(targetId, targetName, config) {
    try {
        await withTokenRetry(async () => {
            await axios.post(
                'https://api.twitch.tv/helix/chat/shoutouts',
                null,
                {
                    params: {
                        from_broadcaster_id: config.BROADCASTER_ID,
                        to_broadcaster_id: targetId,
                        moderator_id: config.BOT_ID,
                    },
                    headers: {
                        'Client-ID': config.CLIENT_ID,
                        'Authorization': `Bearer ${config.BOT_ACCESS_TOKEN}`
                    }
                }
            );
        }, refreshBotToken);
        console.log(`Shoutout: official /shoutout sent for ${targetName}`);
    } catch (err) {
        if (err.response?.status === 429) {
            console.warn(`Shoutout: official /shoutout for ${targetName} skipped — cooldown active`);
        } else {
            console.error('Shoutout: official /shoutout API error:', err.response?.data || err);
        }
    }
}


//SHOUTOUT LOGIC

async function eventShoutout(event, client, config) {
    const raider = event.from_broadcaster_user_name;
    const raiderId = event.from_broadcaster_user_id;
    const viewers = event.viewers;

    console.log(`EventHandlers: ${raider} raided with ${viewers} viewers`);

    client.say(
        `#${config.CHANNEL_NAME}`,
        `🟢 Active network expanded: ${raider} arrived with ${viewers} connections! Welcome in, raiders, the Glosso-Sphere just got a little brighter ✨ Be sure to check out ${raider} and return the signal: https://www.twitch.tv/${raider} 🦊💬`
    ).catch(err => console.error('EventHandlers: Raid message failed:', err));

    await sendTwitchShoutout(raiderId, raider, config);
}

async function shoutout(client, config, users) {
    const soPool = [
        `Hey! go say hi to {user} 🦊💙 they were last streaming {game} — go give them some signal: {link}`,
        `Connection worth checking out: {user}, last seen playing {game}. go reinforce it: {link}`,
        `🦊 Quick signal boost for {user}! catch their last stream of {game} here: {link}`,
        `Psst, go connect with {user} — last spotted streaming {game}: {link}`,
        `{user} deserves some signal today 💙 they were last live with {game}: {link}`
    ];

    const massSoPool = [
        `🦊 A few connections worth reinforcing today, go check them out:`,
        `Signal boost time, multiple nodes detected, go say hi to all of them:`,
        `Before we go, let's send some signal to a couple of friends of the Proxy:`,
        `Quick batch of connections worth your time today:`
    ];

    const massSoUserPool = [
        `> {user}, last streaming {game}: {link}`,
        `> {user} — last seen with {game}: {link}`,
        `> {user}, signal reinforced. last playing {game}: {link}`
    ];

    const fillTemplate = (template, data) =>
        template.replace('{user}', data.user).replace('{game}', data.game).replace('{link}', data.link);

    const results = await getUsersAndGames(users, config);

    if (results.length === 0) {
        console.warn(`Shoutout: none of the provided usernames resolved`, users);
        return;
    }

    if (results.length === 1) {
        const line = soPool[Math.floor(Math.random() * soPool.length)];
        await client.say(`#${config.CHANNEL_NAME}`, fillTemplate(line, results[0]))
            .catch(err => console.error('Shoutout: message failed:', err));

        // ✅ official Twitch shoutout for single-user case
        await sendTwitchShoutout(results[0].id, results[0].user, config);
        return;
    }

    await client.say(
        `#${config.CHANNEL_NAME}`,
        massSoPool[Math.floor(Math.random() * massSoPool.length)]
    ).catch(err => console.error('Shoutout: opener failed:', err));

    for (const data of results) {
        const line = massSoUserPool[Math.floor(Math.random() * massSoUserPool.length)];
        await client.say(`#${config.CHANNEL_NAME}`, fillTemplate(line, data))
            .catch(err => console.error('Shoutout: user line failed:', err));
    }
}

module.exports = {eventShoutout, shoutout};
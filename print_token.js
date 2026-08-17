// print_token.js — run once, then delete
const {config} = require('./config');
const {initTokens} = require('./auth');

initTokens().then(() => {
    console.log('BROADCASTER_ID:', config.BROADCASTER_ID);
    console.log('CLIENT_ID:', config.CLIENT_ID);
    console.log('BROADCASTER_ACCESS_TOKEN:', config.BROADCASTER_ACCESS_TOKEN);
    process.exit(0);
}).catch(err => {
    console.error('Failed to init tokens:', err.message);
    process.exit(1);
});
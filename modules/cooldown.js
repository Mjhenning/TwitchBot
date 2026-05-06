// modules/cooldown.js
const cooldowns = new Map(); // key: userId:command → timestamp
const COMMAND_COOLDOWN = 120000; // 2 minutes

function getCooldownRemaining(userId, command) {
    const key = `${userId}:${command}`;
    if (!cooldowns.has(key)) return 0;
    const elapsed = Date.now() - cooldowns.get(key);
    return Math.max(0, COMMAND_COOLDOWN - elapsed);
}

function setCooldown(userId, command) {
    const key = `${userId}:${command}`;
    cooldowns.set(key, Date.now());
}

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
}

function isModOrBroadcaster(tags) {
    return tags.mod || tags.badges?.broadcaster === '1';
}

function handleCooldown(userId, senderName, command, tags, client, channel) {
    if (isModOrBroadcaster(tags)) return false;

    const remaining = getCooldownRemaining(userId, command);
    if (remaining > 0) {
        const cooldownMsgs = [
            `${senderName}... that process is still cooling (${formatTime(remaining)}) 🫧`,
            `System busy... retry in ${formatTime(remaining)} ✨`,
            `Hold on ${senderName}, command buffer active (${formatTime(remaining)}) 💾`,
            `⚠️ Command on standby for ${formatTime(remaining)}... patience is key ✧`,
            `Signal still warming up... ${formatTime(remaining)} until next input 🦊`
        ];
        client.say(channel, cooldownMsgs[Math.floor(Math.random() * cooldownMsgs.length)]);
        return true;
    }
    setCooldown(userId, command);
    return false;
}

module.exports = { handleCooldown, isModOrBroadcaster, formatTime };
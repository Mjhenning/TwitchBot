// modules/testing_events.js

// ─── Helpers ───────────────────────────────────────────────────────────────────

function dispatch(client, config, fakeEvent, label) {
    console.log(`[SIMULATION] Triggering: ${label}`);
    console.log(`[SIMULATION] Payload:`, JSON.stringify(fakeEvent, null, 2));

    if (client._eventSubHandler) {
        client._eventSubHandler(fakeEvent);
    } else {
        console.warn('[SIMULATION] No _eventSubHandler found — event not dispatched');
    }

    return fakeEvent;
}

function notification(type, event) {
    return {
        metadata: {message_type: 'notification'},
        payload: {subscription: {type}, event}
    };
}

// ─── channel.follow ────────────────────────────────────────────────────────────

function simulateFollow(client, config, username = 'TestUser') {
    return dispatch(client, config, notification('channel.follow', {
        user_id: '123456789',
        user_name: username,
        followed_at: new Date().toISOString()
    }), `channel.follow for ${username}`);
}

// ─── channel.raid ──────────────────────────────────────────────────────────────

function simulateRaid(client, config, raiderName = 'TestRaider', viewers = 42) {
    return dispatch(client, config, notification('channel.raid', {
        from_broadcaster_user_id: '987654321',
        from_broadcaster_user_login: raiderName.toLowerCase(),
        from_broadcaster_user_name: raiderName,
        to_broadcaster_user_id: config.BROADCASTER_ID,
        to_broadcaster_user_name: config.CHANNEL_NAME,
        viewers
    }), `channel.raid from ${raiderName} with ${viewers} viewers`);
}

// ─── channel.ad_break.begin ────────────────────────────────────────────────────

function simulateAdBreak(client, config, durationSeconds = 30, isAutomatic = true, requester = null) {
    return dispatch(client, config, notification('channel.ad_break.begin', {
        duration_seconds: durationSeconds,
        is_automatic: isAutomatic,
        requester_user_id: isAutomatic ? null : '123456789',
        requester_user_login: isAutomatic ? null : (requester ?? 'TestMod').toLowerCase(),
        requester_user_name: isAutomatic ? null : (requester ?? 'TestMod'),
        started_at: new Date().toISOString()
    }), `channel.ad_break.begin — ${durationSeconds}s, automatic=${isAutomatic}`);
}

// ─── Batch runner ──────────────────────────────────────────────────────────────

/**
 * Run all simulations in sequence with a delay between each.
 * Useful for a quick end-to-end smoke test.
 *
 * @param {object} client
 * @param {object} config
 * @param {number} delayMs  - ms between each event (default 1500)
 */
async function simulateAll(client, config, delayMs = 1500) {
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    console.log('[SIMULATION] ▶ Running full event suite...\n');

    simulateFollow(client, config, 'FollowSimUser');
    await delay(delayMs);
    simulateRaid(client, config, 'RaidSimUser', 99);
    await delay(delayMs);
    simulateAdBreak(client, config, 30, true);
    await delay(delayMs);
    simulateAdBreak(client, config, 60, false, 'ModSimUser');

    console.log('\n[SIMULATION] ✓ Full event suite complete');
}

module.exports = {
    simulateFollow,
    simulateRaid,
    simulateAdBreak,
    simulateAll
};
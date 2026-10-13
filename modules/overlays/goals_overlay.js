// modules/overlays/goals_overlay.js
// Glosso-thon goals overlay. It shares the timer's Glosso-thon state: the gifted
// sub count banked in data/glossothon.json drives the goal progress, and the same
// active flag hides the window when the Glosso-thon system is off. It only reads
// that state, so the timer module stays the single source of truth.
const {registerOverlay, broadcast} = require('./overlay_hub');
const {getTimerState, onStateChange} = require('./timer_overlay');

const CHANNEL = 'goals';

//---------------------STATE---------------------
// Push the shared gifted-sub count. The goals list itself lives in the HTML.
function snapshot() {
    const st = getTimerState();
    return {
        type: 'goals',
        active: st.active,
        current: st.subs
    };
}

// Manually show the goals overlay. Only shows if the Glosso-thon system is active.
// Otherwise follows the timer's master switch behavior.
function triggerGoalsOverlay() {
    if (!getTimerState().active) return;
    const st = getTimerState();
    broadcast(CHANNEL, {
        type: 'goals',
        active: st.active,
        current: st.subs
    });
}

//---------------------WIRING---------------------
// Greet a fresh source with the current count, then follow every state change.
registerOverlay(CHANNEL, {
    onConnect: (socket) => {
        try {
            socket.send(JSON.stringify(snapshot()));
        } catch {
            // socket vanished before we could greet it
        }
    }
});

onStateChange(() => broadcast(CHANNEL, snapshot()));

module.exports = {
    getGoalsState: snapshot,
    triggerGoalsOverlay
};

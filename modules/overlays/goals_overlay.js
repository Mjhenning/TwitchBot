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

// Manually show the goals overlay (similar to the Top 10 overlay trigger).
// Forces active=true with the current gifted-sub count so the browser source
// becomes visible regardless of the timer's master switch. State changes from
// the timer will continue to update/hide it afterwards.
function triggerGoalsOverlay() {
    const st = getTimerState();
    broadcast(CHANNEL, {
        type: 'goals',
        active: true,
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

// modules/overlays/goals_overlay.js
// Glosso-thon goals overlay. It reads the timer module's shared Glosso-thon state:
// the banked gifted-sub count drives goal progress and the goals list is pushed
// along with it. Visibility follows the master switch plus its own pin: the window
// is hidden by default, stays up only while `active` and pinned, and can be shown
// transiently with !goals or automatically when a gift sub lands while unpinned.
// It only reads state, so the timer module stays the single source of truth.
const {registerOverlay, broadcast, isBusy, isStarted} = require('./overlay_hub');
const {getTimerState, getGoals, onStateChange} = require('./timer_overlay');

const CHANNEL = 'goals';
const Logger = require('../../services/Logger');

//---------------------STATE---------------------
// Push the shared gifted-sub count and goals list. The layout itself lives in the HTML.
function snapshot() {
    const st = getTimerState();
    return {
        type: 'goals',
        active: st.active,
        pins: st.pins,
        current: st.subs,
        goals: getGoals()
    };
}

// Show the goals overlay for a transient window. The master switch and the pin
// both override this: while thon is off or the goals are pinned the window is
// already handled, so the show is ignored. The HTML owns the timing: it reads the
// pre-show count as the climb start and choreographs a bigger drop (fade in, hold,
// climb goal by goal, hold, fade out) proportional to how many subs just landed.
function triggerGoalsOverlay() {
    if (!isStarted()) {
        Logger.warn('[GoalsOverlay] triggerGoalsOverlay() called before startOverlayHub()');
        return;
    }
    if (isBusy(CHANNEL)) return;

    const st = getTimerState();
    if (!st.active) {
        Logger.log('[GoalsOverlay] Thon inactive, ignoring transient show');
        return;
    }
    if (st.pins.goals) {
        Logger.log('[GoalsOverlay] Pinned, ignoring transient show');
        return;
    }
    const {sent, count} = broadcast(CHANNEL, {
        type: 'show-goals',
        active: st.active,
        pins: st.pins,
        current: st.subs,
        goals: getGoals()
    }, {awaitAck: true});
    if (sent) {
        Logger.log(`[GoalsOverlay] Triggered (${count} client(s)), awaiting ACK`);
    }
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

// Follow every state change. A gift sub arriving while the thon is armed and the
// goals are unpinned fades the window in (when it is not already up); any other
// change, or a gift landing while the window is already showing, just pushes the
// new count so the source updates and extends.
let lastSubs = getTimerState().subs;
onStateChange((st) => {
    const gained = st.subs > lastSubs;
    lastSubs = st.subs;
    if (gained && st.active && !st.pins.goals && !isBusy(CHANNEL)) {
        triggerGoalsOverlay();
        return;
    }
    broadcast(CHANNEL, snapshot());
});

module.exports = {
    getGoalsState: snapshot,
    triggerGoalsOverlay
};

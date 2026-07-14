// modules/stream-state.js
let isOnline = false;
const listeners = {online: [], offline: []};

function setOnline() {
    if (isOnline) return;
    isOnline = true;
    listeners.online.forEach(fn => fn());
}

function setOffline() {
    if (!isOnline) return;
    isOnline = false;
    listeners.offline.forEach(fn => fn());
}

function resetListeners() {
    isOnline = false;
    listeners.online.length = 0;
    listeners.offline.length = 0;
}

function getIsOnline() {
    return isOnline;
}

function onOnline(fn) {
    listeners.online.push(fn);
}

function onOffline(fn) {
    listeners.offline.push(fn);
}

module.exports = {setOnline, setOffline, getIsOnline, onOnline, onOffline, resetListeners};
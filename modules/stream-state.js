// modules/stream-state.js
let isOnline = false;
const listeners = {online: [], offline: []};

function setOnline() {
    isOnline = true;
    listeners.online.forEach(fn => fn());
}

function setOffline() {
    isOnline = false;
    listeners.offline.forEach(fn => fn());
}

function resetListeners() {
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
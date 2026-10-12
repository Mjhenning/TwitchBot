// modules/overlays/overlay_hub.js
// Generic WebSocket hub shared by every OBS browser-source overlay. One server
// process, many named channels: a source picks its channel with ?overlay=<name>
// on the connect URL. Feature modules call registerOverlay() to declare their
// channel and receive its messages, and broadcast() to push payloads to just
// that channel. Channels are isolated, there is no cross-channel traffic.
//
// The optional busy/ACK lock is per channel: when a payload is broadcast with
// {awaitAck:true} the channel is marked busy until every recipient ACKs with
// {"type":"done"} (or drops). This is what keeps the Top 10 and profile
// animations from replaying over themselves.
const WebSocket = require('ws');
const {config} = require('../../config');
const {Logger} = require('../../services');

const OVERLAY_WS_PORT = config.OVERLAY_WS_PORT;

let wss = null;

// name -> { sockets, busy, awaitingAck, onConnect, onMessage, onDisconnect }
const channels = new Map();

//---------------------REGISTRY---------------------

function getChannel(name) {
    if (!channels.has(name)) {
        channels.set(name, {
            sockets: new Set(),
            busy: false,
            awaitingAck: new Set(),
            onConnect: null,
            onMessage: null,
            onDisconnect: null,
        });
    }
    return channels.get(name);
}

// Declare a channel and optionally hook its browser source lifecycle. Safe to
// call at require-time with no handlers if a module only broadcasts.
function registerOverlay(name, handlers = {}) {
    const ch = getChannel(name);
    if (handlers.onConnect) ch.onConnect = handlers.onConnect;
    if (handlers.onMessage) ch.onMessage = handlers.onMessage;
    if (handlers.onDisconnect) ch.onDisconnect = handlers.onDisconnect;

    return {
        name,
        broadcast: (payload, options) => broadcast(name, payload, options),
        isBusy: () => ch.busy,
        clientCount: () => ch.sockets.size,
    };
}

//---------------------LIFECYCLE---------------------

function startOverlayHub() {
    if (wss) return; // already started

    wss = new WebSocket.Server({port: OVERLAY_WS_PORT});

    const server = wss; // captured so socket close handlers survive stopOverlayHub()

    wss.on('connection', (socket, req) => {
        const name = parseOverlayName(req);
        if (!name) {
            Logger.warn('[OverlayHub] Connection without ?overlay=[name], closing');
            socket.close();
            return;
        }

        const ch = getChannel(name);
        ch.sockets.add(socket);
        Logger.log(`[OverlayHub] "${name}" connected (${ch.sockets.size} on channel, ${server.clients.size} total)`);
        if (ch.onConnect) ch.onConnect(socket);

        socket.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return; // ignore malformed frames from the browser source
            }
            // the busy/ACK lock is generic: any channel can clear it with done
            if (msg.type === 'done') clearAck(name, socket);
            if (ch.onMessage) ch.onMessage(socket, msg);
        });

        socket.on('close', () => {
            ch.sockets.delete(socket);
            clearAck(name, socket); // gone, so it can't be holding the lock
            if (ch.onDisconnect) ch.onDisconnect(socket);
            Logger.log(`[OverlayHub] "${name}" disconnected (${ch.sockets.size} on channel, ${server.clients.size} total)`);
        });

        socket.on('error', (err) => {
            Logger.error(`[OverlayHub] "${name}" socket error: ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        Logger.error(`[OverlayHub] Server error: ${err.message}`);
    });

    Logger.log(`[OverlayHub] Listening on ws://localhost:${OVERLAY_WS_PORT}`);
}

function stopOverlayHub() {
    if (!wss) return;

    for (const ch of channels.values()) {
        ch.sockets.forEach((socket) => {
            try {
                socket.close();
            } catch {
                // socket already gone
            }
        });
        ch.sockets.clear();
        ch.awaitingAck.clear();
        ch.busy = false;
    }

    wss.close();
    wss = null;
    Logger.log('[OverlayHub] Stopped');
}

//---------------------BROADCAST---------------------

// Send a payload to every open socket on the channel. With awaitAck the channel
// is marked busy until each recipient ACKs (see registerOverlay note above).
function broadcast(name, payload, {awaitAck = false} = {}) {
    const ch = getChannel(name);
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);

    let sent = 0;
    ch.sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
            if (awaitAck) ch.awaitingAck.add(socket);
            sent++;
        }
    });

    if (sent > 0 && awaitAck) ch.busy = true;
    return {sent, count: ch.sockets.size};
}

function clearAck(name, socket) {
    const ch = getChannel(name);
    ch.awaitingAck.delete(socket);
    if (ch.awaitingAck.size === 0) ch.busy = false;
}

//---------------------HELPERS---------------------

function parseOverlayName(req) {
    try {
        const url = new URL(req.url, 'http://localhost');
        const name = url.searchParams.get('overlay');
        return name ? name.trim() : null;
    } catch {
        return null;
    }
}

function isBusy(name) {
    return getChannel(name).busy;
}

function clientCount(name) {
    return getChannel(name).sockets.size;
}

function isStarted() {
    return !!wss;
}

module.exports = {
    registerOverlay,
    startOverlayHub,
    stopOverlayHub,
    broadcast,
    isBusy,
    clientCount,
    isStarted,
};

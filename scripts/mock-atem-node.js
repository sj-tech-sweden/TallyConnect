#!/usr/bin/env node
/**
 * Minimal ATEM simulator for developing/testing TallyConnect without hardware.
 *
 * Speaks the exact UDP protocol that `atem-connection` (the library the app
 * uses) expects, so the app connects exactly as it would to a real switcher.
 * Each ATEM command is sent in its own UDP packet (atem-connection parses the
 * first frame of a packet reliably; batching several commands in one packet is
 * fragile across versions).
 *
 *   npm run mock                 # udp://0.0.0.0:9910  +  http control :9932
 *
 * Then point TallyConnect at 127.0.0.1, or:  ATEM_IP=127.0.0.1 npm run dev
 *
 * Flip the tally during development without a real switcher:
 *   curl 'http://localhost:9932/set?program=2&preview=3'
 *
 * (Note: pyAtemSim is also available via `npm run mock:pyatem`, but it uses an
 *  older ATEM header that atem-connection does not understand, so it will not
 *  connect to this app.)
 */
const dgram = require('dgram');
const http = require('http');

const ATEM_PORT = parseInt(process.env.ATEM_MOCK_PORT || '9910', 10);
const ATEM_ADDRESS = process.env.ATEM_MOCK_ADDRESS || '0.0.0.0';
const HTTP_PORT = parseInt(process.env.ATEM_MOCK_HTTP_PORT || '9932', 10);

// Internal simulated state
const sim = {
  programInput: parseInt(process.env.ATEM_MOCK_PROGRAM || '1', 10),
  previewInput: parseInt(process.env.ATEM_MOCK_PREVIEW || '0', 10),
  mixEffects: 1,
};

const socket = dgram.createSocket('udp4');
let keepAliveTimer = null;
let sessionCounter = 0x8001;

// Multiple controllers (TallyConnect, ATEM Software Control, …) can connect to a
// real ATEM at once, each with its own session. Track every client independently
// so each gets its own packet-id sequence and session id.
const clients = new Map(); // "address:port" -> { address, port, nextPacketId, sessionId, lastSeen }

function clientKey(address, port) {
  return `${address}:${port}`;
}

function getOrCreateClient(address, port) {
  const key = clientKey(address, port);
  let client = clients.get(key);
  if (!client) {
    client = { address, port, nextPacketId: 1, sessionId: sessionCounter++, lastSeen: Date.now() };
    clients.set(key, client);
  }
  client.lastSeen = Date.now();
  return client;
}

// Drop clients we have not heard from in a while (UDP is connectionless, so a
// disconnect is silent). Active clients are seen at least every keepalive.
const CLIENT_IDLE_MS = 30000;
function activeClients() {
  const now = Date.now();
  for (const [key, client] of clients) {
    if (now - client.lastSeen > CLIENT_IDLE_MS) clients.delete(key);
  }
  return [...clients.values()];
}

socket.on('error', (err) => {
  // A send() to a client that has since disconnected surfaces as ECONNREFUSED on
  // this socket; that is benign for a dev mock, so only a bind failure is fatal.
  if (err && err.code === 'EADDRINUSE') {
    console.error(`ATEM simulator cannot bind ${ATEM_ADDRESS}:${ATEM_PORT} — another process is already using it.`);
    process.exit(1);
  }
  console.error('ATEM simulator socket error (non-fatal):', err.message);
});

socket.on('message', (buf, rinfo) => {
  const length = buf.readUInt16BE(0) & 0x07ff;
  if (length !== rinfo.size) return; // malformed
  const flags = buf.readUInt8(0) >> 3;
  const remotePacketId = buf.readUInt16BE(10);
  const client = getOrCreateClient(rinfo.address, rinfo.port);

  if (flags & 2) {
    // NewSessionId — client handshake hello. Reply with our hello answer and a
    // fresh session: atem-connection tracks the server's packet sequence per
    // session and treats a large jump as out-of-order packets it will wait for
    // forever, so a (re)connecting client must start its sequence at 1 again.
    client.nextPacketId = 1;
    client.sessionId = sessionCounter++;
    socket.send(buildHelloAnswer(client), client.port, client.address);
    // Send the initial state a moment later so it arrives after the hello.
    setTimeout(() => {
      sendInit(client);
      if (!keepAliveTimer) startKeepAlive();
    }, 50);
  } else if (flags & 1) {
    // Client sent a command (a request for data, or a control command such as a
    // program/preview change). Acknowledge it, apply any control commands, and
    // reply with our current state so the client sees a live switcher.
    const frames = parseCommandFrames(buf.subarray(12));
    for (const f of frames) {
      if (f.name === 'CPgI' && f.data.length >= 4) {
        sim.programInput = f.data.readUInt16BE(2);
      } else if (f.name === 'CPvI' && f.data.length >= 4) {
        sim.previewInput = f.data.readUInt16BE(2);
      }
    }
    socket.send(buildAckReply(client, remotePacketId), client.port, client.address);
    sendFullState(client);
    // A control command changed the switcher state — push it to every client.
    for (const other of activeClients()) {
      if (other !== client) sendState(other);
    }
  }
  // AckReply (16) from the client needs no response.
});

socket.bind(ATEM_PORT, ATEM_ADDRESS, () => {
  console.log(`ATEM simulator listening on udp://${ATEM_ADDRESS}:${ATEM_PORT}`);
  console.log('Point TallyConnect ATEM IP at 127.0.0.1 to connect.');
  console.log(`HTTP control: http://localhost:${HTTP_PORT}/set?program=2&preview=3`);
});

// --- Packet builders (ATEM UDP framing) ---

function buildHelloAnswer(client) {
  const pkt = Buffer.alloc(20);
  // flags = NewSessionId (2) << 11, length = 20
  pkt.writeUInt16BE((2 << 11) | 20, 0);
  pkt.writeUInt16BE(client.sessionId, 2);
  // payload: 02 00 <clientId> 00 00 00 00  (matches the protocol handshake)
  pkt.writeUInt16BE(0x0200, 12);
  pkt.writeUInt16BE(0x0001, 14);
  return pkt;
}

function buildAckReply(client, ackedPacketId) {
  const pkt = Buffer.alloc(12);
  // flags = AckReply (16) << 11, length = 12
  pkt.writeUInt16BE((16 << 11) | 12, 0);
  pkt.writeUInt16BE(client.sessionId, 2);
  pkt.writeUInt16BE(ackedPacketId, 4);
  return pkt;
}

function commandFrame(name, data) {
  const len = 8 + data.length;
  const frame = Buffer.alloc(len);
  frame.writeUInt16BE(len, 0);
  frame.writeUInt16BE(0, 2); // reserved
  frame.write(name, 4, 'ascii');
  data.copy(frame, 8);
  return frame;
}

// Parse the command frames inside a client->server packet payload (after the
// 12-byte header). Each frame is [length:2][reserved:2][name:4][data].
function parseCommandFrames(payload) {
  const frames = [];
  let buffer = payload;
  while (buffer.length > 8) {
    const length = buffer.readUInt16BE(0);
    if (length < 8) break;
    const name = buffer.toString('ascii', 4, 8);
    frames.push({ name, data: buffer.subarray(8, length) });
    buffer = buffer.subarray(length);
  }
  return frames;
}

function buildCommandPacket(client, name, data) {
  const frame = commandFrame(name, data);
  const total = 12 + frame.length;
  const pkt = Buffer.alloc(total);
  // flags = AckRequest (1) << 11
  pkt.writeUInt16BE((1 << 11) | total, 0);
  pkt.writeUInt16BE(client.sessionId, 2);
  pkt.writeUInt16BE(client.nextPacketId++, 10);
  frame.copy(pkt, 12);
  return pkt;
}

// Send a single ATEM command as its own packet.
function sendCommand(client, name, data) {
  const pkt = buildCommandPacket(client, name, data);
  if (process.env.ATEM_MOCK_DEBUG) console.error('SEND', name, client.nextPacketId - 1, pkt.toString('hex'));
  socket.send(pkt, client.port, client.address);
}

// Send several commands back-to-back but spaced out slightly. Sending many UDP
// datagrams with no gap can cause packet loss on the loopback interface.
function sendCommandsSpaced(client, commands) {
  const gap = parseInt(process.env.ATEM_MOCK_GAP || '15', 10);
  commands.forEach(([name, data], i) => {
    setTimeout(() => sendCommand(client, name, data), i * gap);
  });
}

function sendState(client) {
  // Topology: tells the client how many mix effects exist (protocol V7_2 layout).
  const topology = Buffer.alloc(23);
  topology.writeUInt8(sim.mixEffects, 0); // mixEffects count

  // Program / preview for mix effect 0 (shared switcher state for all clients).
  const program = Buffer.alloc(4);
  program.writeUInt8(0, 0); // mixEffect index
  program.writeUInt16BE(sim.programInput, 2);

  const preview = Buffer.alloc(4);
  preview.writeUInt8(0, 0);
  preview.writeUInt16BE(sim.previewInput, 2);

  sendCommandsSpaced(client, [
    ['_top', topology],
    ['PrgI', program],
    ['PrvI', preview],
  ]);
}

// Full state used for the init burst and as a reply to client data requests:
// protocol version + topology + program + preview (no InitComplete — that is only
// sent once, after the handshake, to mark the connection as established).
function sendFullState(client) {
  const version = Buffer.alloc(4);
  version.writeUInt32BE(0x20016, 0); // ProtocolVersion.V7_2
  sendCommand(client, '_ver', version);
  sendState(client);
}

// The first batch after the handshake also carries the protocol version and an
// InitComplete command so atem-connection transitions to "connected".
// NOTE: InitComplete needs a non-zero payload: atem-connection's command parser
// loops `while (buffer.length > 8)`, so an 8-byte (zero-data) frame at the end
// would be skipped.
function sendInit(client) {
  sendFullState(client);
  setTimeout(() => sendCommand(client, 'InCm', Buffer.alloc(1)), 60);
}

function startKeepAlive() {
  keepAliveTimer = setInterval(() => {
    for (const client of activeClients()) sendState(client);
  }, 2000);
}

// --- HTTP control (flip program/preview during development) ---

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  if (url.pathname === '/set') {
    const program = url.searchParams.get('program');
    const preview = url.searchParams.get('preview');
    if (program !== null) sim.programInput = parseInt(program, 10) || 0;
    if (preview !== null) sim.previewInput = parseInt(preview, 10) || 0;
    for (const client of activeClients()) sendState(client);
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ programInput: sim.programInput, previewInput: sim.previewInput }));
});

server.listen(HTTP_PORT, () => {
  console.log(`ATEM simulator HTTP control on http://localhost:${HTTP_PORT}`);
});

function shutdown() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  socket.close();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

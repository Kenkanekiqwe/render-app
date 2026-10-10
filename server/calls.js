const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { URL } = require('url');

const db = require('./db');
const { areFriends } = require('./privacy');
const { findById } = require('./auth');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'render-dev-jwt-secret-change-me';
}

function defaultIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

/** @type {Map<number, Set<WebSocket>>} */
const socketsByUser = new Map();
/** @type {Map<number, string>} userId -> active callId */
const userActiveCall = new Map();
/** @type {Map<string, { a: number, b: number }>} */
const calls = new Map();
/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const disconnectGrace = new Map();

function userIdOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clearDisconnectGrace(userId) {
  const id = userIdOf(userId);
  if (!id) return;
  const timer = disconnectGrace.get(id);
  if (timer) {
    clearTimeout(timer);
    disconnectGrace.delete(id);
  }
}

function publicCallUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarUrl: row.avatar_url || '',
    isAdmin: Boolean(row.is_admin),
  };
}

function addSocket(userId, ws) {
  const id = Number(userId);
  if (!socketsByUser.has(id)) socketsByUser.set(id, new Set());
  socketsByUser.get(id).add(ws);
  ws.userId = id;
}

function removeSocket(ws) {
  const id = ws.userId;
  if (!id) return;
  const set = socketsByUser.get(id);
  if (set) {
    set.delete(ws);
    if (!set.size) socketsByUser.delete(id);
  }
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendToUser(userId, payload) {
  const set = socketsByUser.get(Number(userId));
  if (!set) return false;
  const raw = JSON.stringify(payload);
  let sent = false;
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
      sent = true;
    }
  });
  return sent;
}

function endCall(callId, reason = 'ended') {
  const call = calls.get(callId);
  if (!call) return;
  calls.delete(callId);
  userActiveCall.delete(call.a);
  userActiveCall.delete(call.b);
  const payload = { type: 'call-ended', callId, reason };
  sendToUser(call.a, payload);
  sendToUser(call.b, payload);
}

function attachCallSignaling(server) {
  const wss = new WebSocket.Server({ server, path: '/api/calls/ws' });

  wss.on('connection', (ws, req) => {
    let authed = false;

    (async () => {
      try {
        const reqUrl = new URL(req.url, 'http://localhost');
        const token = (reqUrl.searchParams.get('token') || '').trim();
        if (!token) {
          ws.close(4401, 'Unauthorized');
          return;
        }

        const decoded = jwt.verify(token, getJwtSecret());
        if (!db.isReady()) {
          ws.close(4503, 'Database unavailable');
          return;
        }

        const user = await findById(decoded.sub);
        if (!user || user.is_banned) {
          ws.close(4401, 'Unauthorized');
          return;
        }

        authed = true;
        clearDisconnectGrace(user.id);
        addSocket(user.id, ws);
        sendJson(ws, {
          type: 'ready',
          userId: user.id,
          iceServers: defaultIceServers(),
        });

        ws.on('message', (data) => {
          handleMessage(ws, user, data).catch(() => {
            sendJson(ws, { type: 'error', message: 'call_error' });
          });
        });

        ws.on('close', () => {
          removeSocket(ws);
          const uid = userIdOf(user.id);
          if (!uid) return;
          if (socketsByUser.get(uid)?.size) return;

          clearDisconnectGrace(uid);
          disconnectGrace.set(
            uid,
            setTimeout(() => {
              disconnectGrace.delete(uid);
              if (socketsByUser.get(uid)?.size) return;
              const activeCallId = userActiveCall.get(uid);
              if (activeCallId) endCall(activeCallId, 'peer_disconnected');
            }, 12000)
          );
        });
      } catch {
        if (!authed) ws.close(4401, 'Unauthorized');
      }
    })();
  });

  async function handleMessage(ws, user, raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const type = msg?.type;
    if (type === 'ping') {
      sendJson(ws, { type: 'pong' });
      return;
    }

    const callId = String(msg.callId || '').trim();
    const toUserId = Number(msg.toUserId);

    if (type === 'call-invite') {
      const callerId = userIdOf(user.id);
      const peerId = userIdOf(toUserId);
      if (!callId || !callerId || !peerId) return;
      if (userActiveCall.has(callerId)) {
        sendJson(ws, { type: 'call-busy', callId, reason: 'self_busy' });
        return;
      }
      if (userActiveCall.has(peerId)) {
        sendJson(ws, { type: 'call-busy', callId, reason: 'peer_busy' });
        return;
      }
      if (!(await areFriends(callerId, peerId))) {
        sendJson(ws, { type: 'call-rejected', callId, reason: 'not_friends' });
        return;
      }

      userActiveCall.set(callerId, callId);
      userActiveCall.set(peerId, callId);
      calls.set(callId, { a: callerId, b: peerId });

      const peer = await findById(peerId);
      const delivered = sendToUser(peerId, {
        type: 'call-incoming',
        callId,
        withVideo: Boolean(msg.withVideo),
        fromUser: publicCallUser(user),
      });

      sendJson(ws, {
        type: 'call-ringing',
        callId,
        toUser: publicCallUser(peer),
        delivered,
      });

      if (!delivered) {
        endCall(callId, 'unavailable');
        sendJson(ws, { type: 'call-unavailable', callId });
      }
      return;
    }

    if (type === 'call-cancel') {
      if (!callId) return;
      const call = calls.get(callId);
      const me = userIdOf(user.id);
      if (!call || !me || call.a !== me) return;
      endCall(callId, 'cancelled');
      sendToUser(call.b, { type: 'call-cancelled', callId });
      return;
    }

    if (type === 'call-reject') {
      if (!callId) return;
      const call = calls.get(callId);
      const me = userIdOf(user.id);
      if (!call || !me || call.b !== me) return;
      endCall(callId, 'rejected');
      sendToUser(call.a, { type: 'call-rejected', callId, reason: 'declined' });
      return;
    }

    if (type === 'call-accept') {
      if (!callId) return;
      const call = calls.get(callId);
      const me = userIdOf(user.id);
      if (!call || !me || call.b !== me) return;
      sendToUser(call.a, {
        type: 'call-accepted',
        callId,
        fromUser: publicCallUser(user),
      });
      return;
    }

    if (type === 'call-end') {
      if (!callId) return;
      const call = calls.get(callId);
      const me = userIdOf(user.id);
      if (!call || !me) return;
      if (call.a !== me && call.b !== me) return;
      endCall(callId, 'ended');
      return;
    }

    if (type === 'signal') {
      const targetId = userIdOf(toUserId);
      if (!callId || !targetId) return;
      const call = calls.get(callId);
      if (!call) return;
      const me = userIdOf(user.id);
      if (!me || (call.a !== me && call.b !== me)) return;
      const peer = call.a === me ? call.b : call.a;
      if (peer !== targetId) return;
      if (!(await areFriends(me, targetId))) return;

      sendToUser(targetId, {
        type: 'signal',
        callId,
        fromUserId: me,
        signalType: msg.signalType,
        data: msg.data,
      });
    }
  }

  return wss;
}

module.exports = { attachCallSignaling, defaultIceServers };

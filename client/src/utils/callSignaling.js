import { getToken } from './auth';

const RECONNECT_MS = 4000;

export class CallSignalingClient {
  constructor() {
    this.ws = null;
    this.iceServers = null;
    this.userId = null;
    this.listeners = new Set();
    this.reconnectTimer = null;
    this.shouldConnect = false;
    this.pingTimer = null;
    this.ready = false;
    this.outbox = [];
  }

  onMessage(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(msg) {
    this.listeners.forEach((fn) => {
      try {
        fn(msg);
      } catch {
        // Keep other listeners alive if one listener fails.
      }
    });
  }

  getWsUrl() {
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/calls/ws?token=${encodeURIComponent(token)}`;
  }

  connect() {
    this.shouldConnect = true;
    const token = getToken();
    if (!token || this.ws?.readyState === WebSocket.OPEN) return;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.ready = false;

    try {
      this.ws = new WebSocket(this.getWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      // The socket being open is not enough: the server still has to validate
      // the token and register its message handler before we send call events.
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        this.userId = msg.userId;
        this.iceServers = Array.isArray(msg.iceServers) ? msg.iceServers : null;
        this.ready = true;
        this.clearReconnect();
        this.flushOutbox();

        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          this.send({ type: 'ping' });
        }, 25000);
      }

      this.emit(msg);
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.ready = false;
      this.outbox = [];
      if (this.pingTimer) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.shouldConnect) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.shouldConnect = false;
    this.ready = false;
    this.outbox = [];
    this.clearReconnect();
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.shouldConnect) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  flushOutbox() {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
    const pending = this.outbox;
    this.outbox = [];
    pending.forEach((payload) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payload));
      }
    });
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ready) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }

    // Never queue keepalive packets or messages while explicitly disconnected.
    if (payload?.type === 'ping' || !this.shouldConnect) return false;

    // Calls often begin immediately after login, before the authenticated
    // WebSocket "ready" message arrives. Queue these messages instead of
    // silently dropping the invite/SDP/ICE candidate.
    if (this.outbox.length < 100) this.outbox.push(payload);
    if (!this.ws && getToken()) this.connect();
    return false;
  }

  invite({ callId, toUserId, withVideo }) {
    return this.send({
      type: 'call-invite',
      callId,
      toUserId: Number(toUserId),
      withVideo,
    });
  }

  cancel(callId) {
    return this.send({ type: 'call-cancel', callId });
  }

  accept(callId) {
    return this.send({ type: 'call-accept', callId });
  }

  reject(callId) {
    return this.send({ type: 'call-reject', callId });
  }

  end(callId) {
    return this.send({ type: 'call-end', callId });
  }

  signal({ callId, toUserId, signalType, data }) {
    return this.send({
      type: 'signal',
      callId,
      toUserId: Number(toUserId),
      signalType,
      data,
    });
  }
}

let singleton;
export function getCallSignaling() {
  if (!singleton) singleton = new CallSignalingClient();
  return singleton;
}

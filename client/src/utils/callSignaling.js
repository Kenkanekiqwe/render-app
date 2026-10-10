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
        // ignore listener errors
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

    try {
      this.ws = new WebSocket(this.getWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.clearReconnect();
      this.pingTimer = window.setInterval(() => {
        this.send({ type: 'ping' });
      }, 25000);
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
        this.iceServers = msg.iceServers;
      }
      this.emit(msg);
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
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
    this.clearReconnect();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
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
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
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

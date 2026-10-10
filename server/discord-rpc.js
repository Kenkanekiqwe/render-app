/**
 * Optional server-side Discord RPC.
 * Works only when Node runs on the same machine as Discord Desktop.
 * Enable with DISCORD_RPC_SERVER=1 (e.g. local dev). Remote VPS should keep this off.
 */
const RPC = require('discord-rpc');
const crypto = require('crypto');
const { RPCCommands } = require('discord-rpc/src/constants');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1523406858134487071';
const ENABLED = process.env.DISCORD_RPC_SERVER === '1';

const ACTIVITY_TYPE_LISTENING = 2;
const STATUS_DISPLAY_STATE = 1;

let client = null;
let ready = false;

function isEnabled() {
  return ENABLED && Boolean(CLIENT_ID);
}

async function initDiscordRpc() {
  if (!isEnabled()) return false;

  try {
    client = new RPC.Client({ transport: 'ipc' });

    client.on('ready', () => {
      ready = true;
    });

    client.on('disconnected', () => {
      ready = false;
      client = null;
    });

    await client.login({ clientId: CLIENT_ID });
    await updatePresence({ idle: true });
    return true;
  } catch {
    client = null;
    ready = false;
    return false;
  }
}

function externalImageKey(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return null;
  }
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 32);
  return `mp:external/${hash}/${encodeURIComponent(url)}`;
}

function buildActivity({ title, artist, cover, isPlaying, idle } = {}) {
  if (idle || !String(title || '').trim()) {
    return {
      type: ACTIVITY_TYPE_LISTENING,
      state: 'Render',
      details: 'SoundCloud',
      status_display_type: STATUS_DISPLAY_STATE,
    };
  }

  const song = String(title || '').trim();
  const artistName = String(artist || 'SoundCloud').trim() || 'SoundCloud';

  const activity = {
    type: ACTIVITY_TYPE_LISTENING,
    state: song,
    details: isPlaying ? artistName : `${artistName} · Paused`,
    status_display_type: STATUS_DISPLAY_STATE,
    assets: {
      large_text: song,
    },
  };

  const image = externalImageKey(cover);
  if (image) {
    activity.assets.large_image = image;
  }

  return activity;
}

async function pushActivity(activity) {
  await client.request(RPCCommands.SET_ACTIVITY, {
    pid: process.pid,
    activity,
  });
}

async function updatePresence(payload = {}) {
  if (!isEnabled() || !client || !ready) return false;

  const activity = buildActivity(payload);

  try {
    await pushActivity(activity);
    return true;
  } catch {
    if (!activity.assets?.large_image) {
      return false;
    }
    try {
      delete activity.assets.large_image;
      await pushActivity(activity);
      return true;
    } catch {
      ready = false;
      return false;
    }
  }
}

function clearPresence() {
  if (!client || !ready) return;
  try {
    client.clearActivity();
  } catch {
    // Discord unavailable
  }
}

module.exports = {
  isEnabled,
  initDiscordRpc,
  updatePresence,
  clearPresence,
};

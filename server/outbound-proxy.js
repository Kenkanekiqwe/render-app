const crypto = require('crypto');
const { URL } = require('url');

let cachedAgentOverlay = undefined;
const RELAY_TTL_MS = 3 * 60 * 60 * 1000;

function getSocksHttpProxyRaw() {
  return String(
    process.env.SOUNDCLOUD_PROXY_URL
    || process.env.ALL_PROXY
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || ''
  ).trim();
}

function getRelaySecret() {
  return String(process.env.SOUNDCLOUD_RELAY_SECRET || '').trim();
}

function getRelayPublicBase() {
  return String(process.env.SOUNDCLOUD_RELAY_URL || '').trim().replace(/\/$/, '');
}

function parseProxyUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isSoundCloudHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith('soundcloud.com')
      || host.endsWith('sndcdn.com')
      || host.endsWith('soundcloud.cloud')
    );
  } catch {
    return false;
  }
}

function isMediaCdnHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('sndcdn.com') || host.endsWith('soundcloud.cloud');
  } catch {
    return false;
  }
}

function hasSocksHttpProxy() {
  return Boolean(parseProxyUrl(getSocksHttpProxyRaw()));
}

function hasWorkerRelay() {
  return Boolean(getRelaySecret() && getRelayPublicBase());
}

function hasOutboundHop() {
  return hasSocksHttpProxy() || hasWorkerRelay();
}

function hopLabel() {
  if (hasWorkerRelay()) {
    try {
      return `Cloudflare Worker (${new URL(getRelayPublicBase()).host})`;
    } catch {
      return 'Cloudflare Worker';
    }
  }
  const parsed = parseProxyUrl(getSocksHttpProxyRaw());
  if (!parsed) return '';
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return `${parsed.hostname}:${port}`;
}

function buildAgentOverlay(parsed) {
  const protocol = String(parsed.protocol || 'http:').replace(':', '').toLowerCase();
  const href = parsed.href;

  if (protocol.startsWith('socks')) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    const agent = new SocksProxyAgent(href);
    return { httpAgent: agent, httpsAgent: agent, proxy: false };
  }

  const { HttpsProxyAgent } = require('https-proxy-agent');
  const agent = new HttpsProxyAgent(href);
  return { httpAgent: agent, httpsAgent: agent, proxy: false };
}

function getAxiosProxyOverlay() {
  if (cachedAgentOverlay !== undefined) return cachedAgentOverlay;
  const parsed = parseProxyUrl(getSocksHttpProxyRaw());
  if (!parsed) {
    cachedAgentOverlay = null;
    return null;
  }
  try {
    cachedAgentOverlay = buildAgentOverlay(parsed);
  } catch (error) {
    console.error('SoundCloud outbound proxy failed:', error.message);
    cachedAgentOverlay = null;
  }
  return cachedAgentOverlay;
}

function signRelayPayload(exp, target) {
  return crypto
    .createHmac('sha256', getRelaySecret())
    .update(`${exp}\n${target}`)
    .digest('base64url');
}

function signRelayPath(targetUrl, ttlMs = RELAY_TTL_MS) {
  const target = String(targetUrl || '').trim();
  if (!hasWorkerRelay() || !isSoundCloudHost(target)) return '';
  const exp = String(Date.now() + ttlMs);
  const sig = signRelayPayload(exp, target);
  return `${getRelayPublicBase()}/?url=${encodeURIComponent(target)}&exp=${exp}&sig=${sig}`;
}

function verifyRelaySignature(target, exp, sig) {
  if (!hasWorkerRelay() || !target || !exp || !sig) return false;
  if (Number(exp) <= Date.now()) return false;
  const expected = signRelayPayload(String(exp), String(target));
  const left = Buffer.from(expected);
  const right = Buffer.from(String(sig));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function unwrapRelayUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, 'https://render.local');
    const nested = parsed.searchParams.get('url');
    if (nested && isSoundCloudHost(nested)) {
      return nested;
    }
  } catch {
    // keep original
  }
  return raw;
}

function applySoundCloudTransport(url, config = {}) {
  const overlay = { ...config };
  const agentOverlay = getAxiosProxyOverlay();
  if (agentOverlay) {
    Object.assign(overlay, agentOverlay);
  }
  return { url, config: overlay };
}

function augmentAxiosConfig(config = {}) {
  return applySoundCloudTransport('https://api.soundcloud.com/', config).config;
}

function shouldRelayMedia() {
  if (process.env.RENDER_STREAM_PROXY === '1' || process.env.RENDER_PROXY_MEDIA === '1') {
    return true;
  }
  return hasWorkerRelay();
}

function shouldPipeThroughOrigin() {
  return process.env.RENDER_STREAM_PROXY === '1' || process.env.RENDER_PROXY_MEDIA === '1';
}

module.exports = {
  hasOutboundHop,
  hasWorkerRelay,
  hopLabel,
  applySoundCloudTransport,
  augmentAxiosConfig,
  shouldRelayMedia,
  shouldPipeThroughOrigin,
  isSoundCloudHost,
  isMediaCdnHost,
  unwrapRelayUrl,
  signRelayPath,
  verifyRelaySignature,
};

/**
 * Cloudflare Worker: SoundCloud CDN relay.
 *
 * Paste into Compute → Workers → sc-relay → Edit code → Save and Deploy.
 * Settings → Variables: RELAY_SECRET = SOUNDCLOUD_RELAY_SECRET on the VPS.
 *
 * Do NOT add a Workers Route on render.kanekiq.ru — a bad 302 there
 * turns covers/audio into /artworks-… 404 on the site.
 * The player calls this worker on *.workers.dev directly.
 */
const ALLOWED_SUFFIXES = [
  'soundcloud.com',
  'sndcdn.com',
  'soundcloud.cloud',
];

function isAllowedUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function sign(secret, exp, target) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${exp}\n${target}`)
  );
  return toBase64Url(mac);
}

async function signedRelayUrl(request, secret, target, exp) {
  const next = new URL(request.url);
  const ttlExp = String(exp || Date.now() + 3 * 60 * 60 * 1000);
  next.search = '';
  next.hash = '';
  next.searchParams.set('url', target);
  next.searchParams.set('exp', ttlExp);
  next.searchParams.set('sig', await sign(secret, ttlExp, target));
  return next;
}

function copyUpstreamHeaders(request) {
  const headers = new Headers();
  const allow = [
    'accept',
    'authorization',
    'content-type',
    'range',
    'user-agent',
    'if-range',
    'if-none-match',
    'if-modified-since',
  ];
  for (const name of allow) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-allow-headers': 'range, content-type',
        },
      });
    }
    const secret = String(env.RELAY_SECRET || '');
    const incoming = new URL(request.url);
    const target = incoming.searchParams.get('url') || '';
    const exp = incoming.searchParams.get('exp') || '';
    const sig = incoming.searchParams.get('sig') || '';
    const headerSecret = request.headers.get('x-relay-secret') || '';

    if (!secret) {
      return new Response('Relay not configured', { status: 500 });
    }

    let allowed = headerSecret === secret;
    if (!allowed && exp && sig && Number(exp) > Date.now() && isAllowedUrl(target)) {
      const expected = await sign(secret, exp, target);
      allowed = timingSafeEqual(expected, sig);
    }
    if (!allowed) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (!isAllowedUrl(target)) {
      return new Response('Forbidden host', { status: 403 });
    }

    const method = request.method.toUpperCase();
    const headers = copyUpstreamHeaders(request);
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

    // Follow CDN redirects inside the Worker. Never send Location to the
    // browser — relative /artworks-… and /file.mp3 paths 404 on the site origin.
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'follow',
    });

    const contentType = String(upstream.headers.get('content-type') || '');
    const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(target);
    if (isPlaylist && method === 'GET') {
      const text = await upstream.text();
      const lines = String(text).split('\n');
      const baseUrl = new URL(target);
      const out = [];
      const ttlExp = exp || String(Date.now() + 3 * 60 * 60 * 1000);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          out.push(line);
          continue;
        }
        try {
          const absolute = new URL(trimmed, baseUrl).toString();
          if (!isAllowedUrl(absolute)) {
            out.push(line);
            continue;
          }
          const signed = await signedRelayUrl(request, secret, absolute, ttlExp);
          out.push(signed.toString());
        } catch {
          out.push(line);
        }
      }
      return new Response(out.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
      });
    }

    const out = new Headers();
    const pass = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ];
    for (const name of pass) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    const isImage = /image\//i.test(contentType);
    out.set('cache-control', isImage ? 'public, max-age=86400' : 'no-store');
    out.set('access-control-allow-origin', '*');
    out.delete('location');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  },
};

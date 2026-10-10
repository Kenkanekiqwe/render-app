const crypto = require('crypto');

// Ambiguous characters (0/O, 1/I/L) are excluded so users don't misread them.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CAPTCHA_LENGTH = 5;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const WIDTH = 200;
const HEIGHT = 70;

function getSecret() {
  return process.env.CAPTCHA_SECRET || process.env.JWT_SECRET || 'render-dev-captcha-secret';
}

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function randomText(length = CAPTCHA_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CHARSET[crypto.randomInt(0, CHARSET.length)];
  }
  return out;
}

function normalizeAnswer(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

function randomColor(min, max) {
  const c = () => randomInt(min, max);
  return `rgb(${c()},${c()},${c()})`;
}

/** Build a distorted SVG so simple OCR struggles with it. */
function renderSvg(text) {
  const chars = [...text];
  const step = WIDTH / (chars.length + 1);
  let content = '';

  // Background gradient.
  content += `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${randomColor(18, 40)}"/>
    <stop offset="100%" stop-color="${randomColor(20, 48)}"/>
  </linearGradient></defs>`;
  content += `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>`;

  // Noise lines.
  for (let i = 0; i < 6; i += 1) {
    const x1 = randomInt(0, WIDTH);
    const y1 = randomInt(0, HEIGHT);
    const x2 = randomInt(0, WIDTH);
    const y2 = randomInt(0, HEIGHT);
    content += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randomColor(80, 170)}" stroke-width="${randomInt(1, 2)}" opacity="0.5"/>`;
  }

  // Noise dots.
  for (let i = 0; i < 40; i += 1) {
    content += `<circle cx="${randomInt(0, WIDTH)}" cy="${randomInt(0, HEIGHT)}" r="${randomInt(1, 2)}" fill="${randomColor(90, 200)}" opacity="0.4"/>`;
  }

  // Characters, each rotated/skewed independently.
  chars.forEach((char, index) => {
    const x = step * (index + 1) + randomInt(-6, 6);
    const y = HEIGHT / 2 + randomInt(-4, 6);
    const rotate = randomInt(-28, 28);
    const fontSize = randomInt(30, 40);
    const fill = randomColor(180, 255);
    content += `<text x="${x}" y="${y}" font-family="Verdana, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${fill}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="captcha">${content}</svg>`;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/**
 * Create a captcha. Returns an SVG data URL and a stateless token that encodes
 * a salted hash of the answer plus an expiry, signed with an HMAC. No server
 * state is needed to verify it later.
 */
function createCaptcha() {
  const text = randomText();
  const expires = Date.now() + CAPTCHA_TTL_MS;
  const salt = crypto.randomBytes(8).toString('hex');
  const answerHash = crypto
    .createHash('sha256')
    .update(`${normalizeAnswer(text)}:${salt}`)
    .digest('hex');

  const body = `${answerHash}.${salt}.${expires}`;
  const token = `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
  const svg = renderSvg(text);
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  return { token, image };
}

/** Verify a user's answer against the stateless captcha token. */
function verifyCaptcha(token, answer) {
  if (!token || typeof token !== 'string') return false;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;

  let body;
  try {
    body = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expected = sign(body);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  const [answerHash, salt, expires] = body.split('.');
  if (!answerHash || !salt || !expires) return false;
  if (Date.now() > Number(expires)) return false;

  const candidate = crypto
    .createHash('sha256')
    .update(`${normalizeAnswer(answer)}:${salt}`)
    .digest('hex');

  const candBuf = Buffer.from(candidate);
  const hashBuf = Buffer.from(answerHash);
  return candBuf.length === hashBuf.length && crypto.timingSafeEqual(candBuf, hashBuf);
}

module.exports = { createCaptcha, verifyCaptcha };

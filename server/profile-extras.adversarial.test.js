/**
 * Adversarial regressions for profile-links.
 * Keep these green; they encode attacks that previously succeeded.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfileLinks, parseProfileLinksJson } = require('./profile-extras');

describe('type spoofing', () => {
  it('ATTACK: Telegram button can point at an arbitrary https URL', () => {
    const out = normalizeProfileLinks([{ type: 'telegram', url: 'https://evil.com/phish' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: Discord button can point at an arbitrary https URL', () => {
    const out = normalizeProfileLinks([{ type: 'discord', url: 'https://evil.com/phish' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: t.me URL saved as type=website stays a globe instead of Telegram', () => {
    const out = normalizeProfileLinks([{ type: 'website', url: 'https://t.me/durov' }]);
    assert.equal(out[0]?.type, 'telegram');
  });

  it('ATTACK: https://t.me@evil.com with type=telegram is stored as a Telegram button to evil.com', () => {
    const out = normalizeProfileLinks([{ type: 'telegram', url: 'https://t.me@evil.com/' }]);
    assert.notEqual(out[0]?.type, 'telegram');
  });
});

describe('telegram rewrite destroys real Telegram URLs', () => {
  it('ATTACK: t.me/joinchat invite is truncated to /joinchat', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/joinchat/AbCdEf123456' },
    ]);
    assert.equal(out[0]?.url, 'https://t.me/joinchat/AbCdEf123456');
  });

  it('ATTACK: t.me bot start payload is stripped', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/mybot?start=payload' },
    ]);
    assert.equal(out[0]?.url, 'https://t.me/mybot?start=payload');
  });

  it('ATTACK: t.me/share/url is truncated to /share', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/share/url?url=https://example.com' },
    ]);
    assert.equal(out[0]?.url, 'https://t.me/share/url?url=https://example.com');
  });
});

describe('telegram @username advertised format', () => {
  it('ATTACK: @username in a website row becomes https://username/ instead of t.me', () => {
    const out = normalizeProfileLinks([{ type: 'website', url: '@durov' }]);
    assert.equal(out[0]?.url, 'https://t.me/durov');
    assert.equal(out[0]?.type, 'telegram');
  });
});

describe('host suffix confusion', () => {
  it('ATTACK: notyoutube.com is classified as YouTube', () => {
    const out = normalizeProfileLinks([{ url: 'https://notyoutube.com/watch?v=1' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: evilinstagram.com is classified as Instagram', () => {
    const out = normalizeProfileLinks([{ url: 'https://evilinstagram.com/user' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: faketelegram.me is classified as Telegram', () => {
    const out = normalizeProfileLinks([{ url: 'https://faketelegram.me/user' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: eviltwitch.tv is classified as Twitch', () => {
    const out = normalizeProfileLinks([{ url: 'https://eviltwitch.tv/x' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: fakesoundcloud.com is classified as SoundCloud', () => {
    const out = normalizeProfileLinks([{ url: 'https://fakesoundcloud.com/x' }]);
    assert.equal(out[0]?.type, 'website');
  });

  it('ATTACK: fakespotify.com is classified as Spotify', () => {
    const out = normalizeProfileLinks([{ url: 'https://fakespotify.com/x' }]);
    assert.equal(out[0]?.type, 'website');
  });
});

describe('URL safety', () => {
  it('ATTACK: credentials in a profile URL are persisted', () => {
    const out = normalizeProfileLinks([
      { type: 'website', url: 'https://user:secret@evil.com/x' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(new URL(out[0].url).username, '');
    assert.equal(new URL(out[0].url).password, '');
  });

  it('ATTACK: file: URL is rewritten into a stored https://file... button', () => {
    const out = normalizeProfileLinks([{ type: 'website', url: 'file:///etc/passwd' }]);
    assert.deepEqual(out, []);
  });

  it('ATTACK: CR in the host is stripped so paypal.com\\r.evil.com becomes paypal.com.evil.com', () => {
    const out = normalizeProfileLinks([
      { type: 'website', url: `https://paypal.com${String.fromCharCode(13)}.evil.com` },
    ]);
    assert.deepEqual(out, []);
  });

  it('ATTACK: URLs over 500 chars are truncated into a different still-clickable destination', () => {
    const original = `https://example.com/safe/${'A'.repeat(600)}/keep-me`;
    const out = normalizeProfileLinks([{ type: 'website', url: original }]);
    assert.ok(out.length === 0 || out[0].url.includes('keep-me'), 'must reject or keep the original destination');
  });
});

describe('discord rewrite', () => {
  it('ATTACK: discord.gg event query is stripped', () => {
    const out = normalizeProfileLinks([
      { type: 'discord', url: 'https://discord.gg/abcXYZ?event=123' },
    ]);
    assert.ok(out[0]?.url.includes('event=123'));
  });
});

describe('JSON persist/read', () => {
  it('ATTACK: double-encoded profile_links_json parses to empty and wipes buttons', () => {
    const links = [{ type: 'telegram', url: 'https://t.me/durov' }];
    const out = parseProfileLinksJson(JSON.stringify(JSON.stringify(links)));
    assert.equal(out[0]?.url, 'https://t.me/durov');
  });
});

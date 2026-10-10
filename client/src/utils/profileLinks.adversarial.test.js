/**
 * Adversarial regressions for profile-links.
 * Keep these green; they encode attacks that previously succeeded.
 */
import {
  detectProfileLinkType,
  normalizeProfileLinkUrl,
  normalizeProfileLinks,
} from './profileLinks';
import { buildMigrationPayload, buildProfilePayload } from './profile';
import { normalizeExternalUrl } from './openExternal';

describe('type spoofing', () => {
  test('ATTACK: Telegram button can point at an arbitrary https URL', () => {
    const out = normalizeProfileLinks([{ type: 'telegram', url: 'https://evil.com/phish' }]);
    expect(out[0]?.type).toBe('website');
  });

  test('ATTACK: Discord button can point at an arbitrary https URL', () => {
    const out = normalizeProfileLinks([{ type: 'discord', url: 'https://evil.com/phish' }]);
    expect(out[0]?.type).toBe('website');
  });

  test('ATTACK: t.me URL saved as type=website stays a globe instead of Telegram', () => {
    const out = normalizeProfileLinks([{ type: 'website', url: 'https://t.me/durov' }]);
    expect(out[0]?.type).toBe('telegram');
  });

  test('ATTACK: https://t.me@evil.com with type=telegram is stored as a Telegram button to evil.com', () => {
    const out = normalizeProfileLinks([{ type: 'telegram', url: 'https://t.me@evil.com/' }]);
    expect(out[0]?.type).not.toBe('telegram');
  });
});

describe('telegram rewrite destroys real Telegram URLs', () => {
  test('ATTACK: t.me/joinchat invite is truncated to /joinchat', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/joinchat/AbCdEf123456' },
    ]);
    expect(out[0]?.url).toBe('https://t.me/joinchat/AbCdEf123456');
  });

  test('ATTACK: t.me bot start payload is stripped', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/mybot?start=payload' },
    ]);
    expect(out[0]?.url).toBe('https://t.me/mybot?start=payload');
  });

  test('ATTACK: t.me/share/url is truncated to /share', () => {
    const out = normalizeProfileLinks([
      { type: 'telegram', url: 'https://t.me/share/url?url=https://example.com' },
    ]);
    expect(out[0]?.url).toBe('https://t.me/share/url?url=https://example.com');
  });
});

describe('telegram @username advertised format', () => {
  test('ATTACK: @username in a website row becomes https://username/ instead of t.me', () => {
    const out = normalizeProfileLinks([{ type: 'website', url: '@durov' }]);
    expect(out[0]?.url).toBe('https://t.me/durov');
    expect(out[0]?.type).toBe('telegram');
  });
});

describe('host suffix confusion', () => {
  test('ATTACK: notyoutube.com is classified as YouTube', () => {
    expect(detectProfileLinkType('https://notyoutube.com/watch?v=1')).toBe('website');
  });

  test('ATTACK: evilinstagram.com is classified as Instagram', () => {
    expect(detectProfileLinkType('https://evilinstagram.com/user')).toBe('website');
  });

  test('ATTACK: faketelegram.me is classified as Telegram', () => {
    expect(detectProfileLinkType('https://faketelegram.me/user')).toBe('website');
  });

  test('ATTACK: eviltwitch.tv is classified as Twitch', () => {
    expect(detectProfileLinkType('https://eviltwitch.tv/x')).toBe('website');
  });

  test('ATTACK: fakesoundcloud.com is classified as SoundCloud', () => {
    expect(detectProfileLinkType('https://fakesoundcloud.com/x')).toBe('website');
  });

  test('ATTACK: fakespotify.com is classified as Spotify', () => {
    expect(detectProfileLinkType('https://fakespotify.com/x')).toBe('website');
  });
});

describe('URL safety', () => {
  test('ATTACK: credentials in a profile URL are persisted', () => {
    const out = normalizeProfileLinks([
      { type: 'website', url: 'https://user:secret@evil.com/x' },
    ]);
    expect(out).toHaveLength(1);
    expect(new URL(out[0].url).username).toBe('');
    expect(new URL(out[0].url).password).toBe('');
  });

  test('ATTACK: file: URL is rewritten into a stored https://file... button', () => {
    expect(normalizeProfileLinkUrl('file:///etc/passwd')).toBe('');
  });

  test('ATTACK: CR in the host is stripped so paypal.com\\r.evil.com becomes paypal.com.evil.com', () => {
    const out = normalizeProfileLinks([
      { type: 'website', url: `https://paypal.com${String.fromCharCode(13)}.evil.com` },
    ]);
    expect(out).toEqual([]);
  });
});

describe('discord rewrite', () => {
  test('ATTACK: discord.gg event query is stripped', () => {
    const out = normalizeProfileLinks([
      { type: 'discord', url: 'https://discord.gg/abcXYZ?event=123' },
    ]);
    expect(out[0]?.url).toContain('event=123');
  });
});

describe('persist / migration wipe', () => {
  test('ATTACK: PUT payload always sends links:[] when the client is not editing links', () => {
    const payload = buildProfilePayload({ displayName: 'Ada', username: 'ada' });
    expect(Object.prototype.hasOwnProperty.call(payload, 'links')).toBe(false);
  });

  test('ATTACK: migration copies local avatar/bio/banner but drops local profile links', () => {
    const payload = buildMigrationPayload(
      { displayName: 'Ada', username: 'ada', avatarUrl: '', bio: '', bannerUrl: '' },
      {
        avatarUrl: '',
        bio: '',
        bannerUrl: '',
        links: [{ type: 'telegram', url: 'https://t.me/durov' }],
      }
    );
    expect(payload.links[0]?.url).toBe('https://t.me/durov');
  });
});

describe('click path', () => {
  test('ATTACK: javascript: URL is prefixed to https://javascript:... and still opened', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBe('');
  });

  test('ATTACK: click path opens URLs that still contain user:password credentials', () => {
    const opened = normalizeExternalUrl('https://user:secret@evil.com/x');
    expect(new URL(opened).username).toBe('');
    expect(new URL(opened).password).toBe('');
  });
});

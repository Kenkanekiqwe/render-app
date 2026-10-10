import React from 'react';
import {
  FaDiscord,
  FaGithub,
  FaGlobe,
  FaInstagram,
  FaPlus,
  FaSoundcloud,
  FaSpotify,
  FaTelegramPlane,
  FaTimes,
  FaTwitch,
  FaTwitter,
  FaVk,
  FaYoutube,
} from 'react-icons/fa';
import { openExternalUrl } from '../utils/openExternal';
import {
  MAX_PROFILE_LINKS,
  PROFILE_LINK_TYPES,
  detectProfileLinkType,
  emptyProfileLink,
  normalizeProfileLinkUrl,
  profileLinkMeta,
} from '../utils/profileLinks';

const ICONS = {
  telegram: FaTelegramPlane,
  discord: FaDiscord,
  youtube: FaYoutube,
  instagram: FaInstagram,
  vk: FaVk,
  twitch: FaTwitch,
  soundcloud: FaSoundcloud,
  spotify: FaSpotify,
  github: FaGithub,
  x: FaTwitter,
  website: FaGlobe,
};

function linkLabel(link, t) {
  if (link.label) return link.label;
  return t(`profileLink_${link.type}`) || profileLinkMeta(link.type).label;
}

export function ProfileLinks({ links, t }) {
  const items = Array.isArray(links) ? links.filter((link) => link?.url) : [];
  if (!items.length) return null;

  return (
    <div className="profile-links">
      {items.map((link) => {
        const Icon = ICONS[link.type] || FaGlobe;
        return (
          <button
            key={`${link.type}:${link.url}`}
            type="button"
            className={`profile-link-btn profile-link-btn--${link.type}`}
            onClick={() => openExternalUrl(link.url)}
          >
            <Icon />
            <span>{linkLabel(link, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ProfileLinksEditor({ links, onChange, t }) {
  const items = Array.isArray(links) ? links : [];

  const updateAt = (index, patch) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addLink = (type = 'website') => {
    if (items.length >= MAX_PROFILE_LINKS) return;
    onChange([...items, emptyProfileLink(type)]);
  };

  const removeAt = (index) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <section className="profile-editor-section">
      <h3>{t('profileEditLinks')}</h3>
      <p className="profile-editor-note">{t('profileEditLinksHint')}</p>

      <div className="profile-links-editor">
        {items.map((link, index) => {
          const meta = profileLinkMeta(link.type);
          return (
            <div key={`link-${index}`} className="profile-link-row">
              <select
                value={link.type}
                aria-label={t('profileLinkType')}
                onChange={(event) => updateAt(index, { type: event.target.value })}
              >
                {PROFILE_LINK_TYPES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t(`profileLink_${entry.id}`) || entry.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="url"
                autoComplete="url"
                value={link.url}
                placeholder={meta.placeholder}
                onChange={(event) => updateAt(index, { url: event.target.value })}
                onBlur={(event) => {
                  const normalized = normalizeProfileLinkUrl(event.target.value, link.type);
                  if (!normalized) return;
                  const detected = detectProfileLinkType(normalized);
                  updateAt(index, {
                    url: normalized,
                    type: link.type && link.type !== 'website' ? link.type : detected,
                  });
                }}
              />
              <button
                type="button"
                className="profile-link-remove"
                onClick={() => removeAt(index)}
                aria-label={t('profileLinkRemove')}
              >
                <FaTimes />
              </button>
            </div>
          );
        })}

        {items.length < MAX_PROFILE_LINKS && (
          <div className="profile-link-add">
            {PROFILE_LINK_TYPES.slice(0, 6).map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="profile-link-preset"
                onClick={() => addLink(entry.id)}
              >
                {t(`profileLink_${entry.id}`) || entry.label}
              </button>
            ))}
            <button type="button" className="profile-link-preset is-add" onClick={() => addLink('website')}>
              <FaPlus /> {t('profileLinkAdd')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

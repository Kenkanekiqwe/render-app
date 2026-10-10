const express = require('express');
const db = require('./db');
const { authMiddleware, publicProfile, findById } = require('./auth');
const { applyPrivacyToProfile, areFriends } = require('./privacy');
const { getUserPlaylistsSummary, getUserPlaylistById } = require('./user-playlists');
const { profileExtrasFromRow, parseNowPlayingJson } = require('./profile-extras');
const { loadEquippedCosmetics } = require('./cosmetics');

const router = express.Router();

router.get('/:id/profile', authMiddleware, async (req, res) => {
  try {
    const user = await findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const viewerId = req.user.id;
    const isOwner = user.id === viewerId;
    const profile = applyPrivacyToProfile(publicProfile(user), user, { isOwner });

    if (!profile) {
      return res.status(404).json({ error: 'Профиль скрыт' });
    }

    const isFriend = isOwner || (await areFriends(viewerId, user.id));
    let playlists = [];
    const playlistsHidden = !isOwner && Boolean(user.privacy_hide_playlists);
    const equippedCosmetics = await loadEquippedCosmetics(user.id);

    if (isFriend && !user.privacy_hide_playlists) {
      playlists = await getUserPlaylistsSummary(user.id);
    }

    const extras = profileExtrasFromRow(user);
    let nowPlaying = null;
    if (isFriend && !user.privacy_hide_now_playing) {
      nowPlaying = parseNowPlayingJson(user.now_playing_json);
    }

    res.json({
      profile: {
        ...profile,
        pinnedTrack: extras.pinnedTrack,
        links: extras.links || [],
        equippedCosmetics,
      },
      playlists,
      isFriend,
      playlistsHidden,
      nowPlaying,
    });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить профиль' });
  }
});

router.get('/:id/playlists/:playlistId', authMiddleware, async (req, res) => {
  try {
    const user = await findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const viewerId = req.user.id;
    const isOwner = user.id === viewerId;

    if (!isOwner && user.privacy_hide_playlists) {
      return res.status(403).json({ error: 'Плейлисты скрыты' });
    }

    const isFriend = isOwner || (await areFriends(viewerId, user.id));
    if (!isFriend) {
      return res.status(403).json({ error: 'Доступ только для друзей' });
    }

    const playlist = await getUserPlaylistById(user.id, req.params.playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Плейлист не найден' });
    }

    res.json({
      playlist,
      ownerName: user.display_name || user.username,
    });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить плейлист' });
  }
});

module.exports = { router };

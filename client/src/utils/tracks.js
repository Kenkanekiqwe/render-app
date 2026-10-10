import { resolvePublicMediaUrl } from './mediaUrl';

const FALLBACK_COVER = 'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg';

function unwrapProxyCover(url) {
  return resolvePublicMediaUrl(url, FALLBACK_COVER);
}

export function isValidTrack(track) {
  return Boolean(
    track?.id &&
      track?.title &&
      track.title !== 'Unknown' &&
      track?.artist &&
      track.artist !== 'Unknown' &&
      track?.soundcloudUrl &&
      Number(track.duration) > 0
  );
}

export function filterValidTracks(tracks) {
  return (tracks || []).filter(isValidTrack);
}

export function getTrackCover(track) {
  return resolvePublicMediaUrl(track?.cover || track?.coverThumb, FALLBACK_COVER);
}

export function resolveCoverUrl(url) {
  return resolvePublicMediaUrl(url, FALLBACK_COVER);
}

export { FALLBACK_COVER, unwrapProxyCover };

import { createContext, useContext } from 'react';

const PlaybackExtrasContext = createContext({
  userQueue: [],
  addToQueue: () => {},
  playNext: () => {},
  playRadio: () => {},
  removeFromQueue: () => {},
  clearQueue: () => {},
  moveInQueue: () => {},
});

export function usePlaybackExtras() {
  return useContext(PlaybackExtrasContext);
}

export default PlaybackExtrasContext;

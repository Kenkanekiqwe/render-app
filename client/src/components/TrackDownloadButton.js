import React, { useCallback, useEffect, useState } from 'react';
import { FaCheck, FaDownload, FaSpinner } from 'react-icons/fa';
import { downloadTrack } from '../utils/offlineCache';

const inFlight = new Map();

export function useTrackDownload(trackId) {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const id = String(trackId || '');

  useEffect(() => {
    setState(inFlight.has(id) ? 'downloading' : 'idle');
    setProgress(0);
  }, [id]);

  const start = useCallback(async (track, options = {}) => {
    const nextId = String(track?.id || id || '');
    if (!nextId || inFlight.has(nextId)) return null;

    const controller = new AbortController();
    inFlight.set(nextId, controller);
    setState('downloading');
    setProgress(0);

    try {
      const blob = await downloadTrack(track, {
        ...options,
        signal: controller.signal,
        onProgress: (value) => {
          setProgress(value);
          options.onProgress?.(value);
        },
      });
      setState('done');
      setProgress(1);
      window.setTimeout(() => {
        setState((prev) => (prev === 'done' ? 'idle' : prev));
      }, 1800);
      return blob;
    } catch (error) {
      if (error?.name === 'AbortError') {
        setState('idle');
        return null;
      }
      setState('error');
      return null;
    } finally {
      inFlight.delete(nextId);
    }
  }, [id]);

  return { state, progress, start };
}

function TrackDownloadButton({
  track,
  className = '',
  titleFor,
  compact = false,
  labelText = '',
}) {
  const { state, progress, start } = useTrackDownload(track?.id);
  const busy = state === 'downloading';

  const label = titleFor?.(state, progress) || labelText || '';

  return (
    <button
      type="button"
      className={`${className}${state === 'done' ? ' is-done' : ''}${state === 'error' ? ' is-error' : ''}${busy ? ' is-busy' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) start(track);
      }}
      disabled={busy || !track?.id}
      title={label}
      aria-label={label}
      role={labelText ? 'menuitem' : undefined}
    >
      {busy ? (
        compact ? (
          <span className="track-download-pct">{Math.round(progress * 100)}</span>
        ) : (
          <FaSpinner className="track-download-spin" />
        )
      ) : state === 'done' ? (
        <FaCheck />
      ) : (
        <FaDownload />
      )}
      {labelText ? <span>{labelText}</span> : null}
    </button>
  );
}

export default TrackDownloadButton;

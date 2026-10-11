import React, { useEffect, useRef, useState } from 'react';
import './VoiceCall.css';
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaPhoneSlash,
  FaVideo,
  FaVideoSlash,
  FaDesktop,
  FaVolumeMute,
  FaVolumeUp,
  FaCog,
  FaPhone,
  FaMinus,
  FaExpand,
  FaCompress,
} from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { useCall } from '../context/CallContext';
import AvatarImage from './AvatarImage';
import { AdminPlaque } from './ProfileCosmetics';

function VideoTile({ stream, muted, label, className = '' }) {
  const ref = useRef(null);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  useEffect(() => {
    const node = ref.current;
    setHasVideoFrame(false);
    if (!node) return undefined;
    if (stream) {
      node.srcObject = stream;
      node.play().catch(() => {});
    } else {
      node.srcObject = null;
    }
    return () => {
      if (node) { node.pause(); node.srcObject = null; }
    };
  }, [stream]);

  if (!stream) return null;

  return (
    <div className={`voice-call-tile ${className}${hasVideoFrame ? ' has-video-frame' : ' is-waiting-for-video'}`}>
      <video ref={ref} autoPlay playsInline muted={muted} onLoadedData={() => setHasVideoFrame(true)} onPlaying={() => setHasVideoFrame(true)} />
      {!hasVideoFrame && <div className="voice-call-video-waiting" role="status"><span className="voice-call-video-waiting-dot" />Ожидание видеопотока…</div>}
      {label ? <span className="voice-call-tile-label">{label}</span> : null}
    </div>
  );
}
function IncomingCallModal() {
  const { t } = useLanguage();
  const { remoteUser, incomingWithVideo, acceptCall, rejectCall } = useCall();

  return (
    <div className="voice-call-incoming-backdrop" role="dialog" aria-modal="true">
      <div className="voice-call-incoming-card voice-call-incoming-card--pulse">
        <div className="voice-call-incoming-rings" aria-hidden />
        <div className="voice-call-incoming-avatar">
          <AvatarImage
            url={remoteUser?.avatarUrl}
            fallback={remoteUser?.displayName?.[0] || remoteUser?.username?.[0] || '?'}
          />
        </div>
        <p className="voice-call-incoming-kicker">{t('callIncoming')}</p>
        <h2 className="voice-call-incoming-name">
          {remoteUser?.displayName || remoteUser?.username}
          <AdminPlaque isAdmin={remoteUser?.isAdmin} />
        </h2>
        <p className="voice-call-incoming-sub">
          {incomingWithVideo ? t('callIncomingVideo') : t('callIncomingVoice')}
        </p>
        <div className="voice-call-incoming-actions">
          <button type="button" className="voice-call-btn voice-call-btn--reject" onClick={rejectCall}>
            <FaPhoneSlash /> {t('callDecline')}
          </button>
          <button type="button" className="voice-call-btn voice-call-btn--accept" onClick={acceptCall}>
            <FaPhone /> {t('callAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveCallPanel({ onMinimize, remoteVolume, onRemoteVolumeChange }) {
  const { t } = useLanguage();
  const {
    remoteUser,
    phase,
    withVideo,
    muted,
    deafened,
    videoEnabled,
    screenSharing,
    remoteScreenSharing,
    localStream,
    remoteStream,
    screenStream,
    screenSettings,
    audioSettings,
    connectionState,
    hangUp,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
    applyScreenSettings,
    applyAudioSettings,
  } = useCall();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [microphoneDevices, setMicrophoneDevices] = useState([]);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const stageRef = useRef(null);

  useEffect(() => {
    if (!settingsOpen || !navigator.mediaDevices?.enumerateDevices) return undefined;
    let cancelled = false;
    const refreshDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setMicrophoneDevices(devices.filter((device) => device.kind === 'audioinput'));
      } catch {
        if (!cancelled) setMicrophoneDevices([]);
      }
    };
    refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [settingsOpen]);

  useEffect(() => {
    const track = localStream?.getAudioTracks?.()[0];
    if (!settingsOpen || !track || typeof window === 'undefined') {
      setMicrophoneLevel(0);
      return undefined;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return undefined;
    let audioContext;
    let animationFrame = 0;
    let source;
    let analyser;
    let cancelled = false;
    const sample = () => {
      if (cancelled || !analyser) return;
      const values = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (let i = 0; i < values.length; i += 1) {
        const normalized = (values[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / values.length);
      setMicrophoneLevel(Math.min(100, Math.round(rms * 260)));
      animationFrame = window.requestAnimationFrame(sample);
    };
    try {
      audioContext = new AudioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
      audioContext.resume().catch(() => {});
      sample();
    } catch {
      setMicrophoneLevel(0);
    }
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      source?.disconnect();
      analyser?.disconnect();
      audioContext?.close().catch(() => {});
    };
  }, [settingsOpen, localStream]);
  const [stageFullscreen, setStageFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => setStageFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleStageFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement && stage.requestFullscreen) {
        await stage.requestFullscreen();
      }
    } catch {
      // Fullscreen can be denied by browser policy; regular calling still works.
    }
  };

  // Keep the video tile mounted while a remote track is temporarily muted during startup.
  const remoteVideo = remoteStream?.getVideoTracks?.().some(
    (track) => track.readyState === 'live'
  ) ? remoteStream : null;
  const localCamera = withVideo && videoEnabled ? localStream : null;
  // The main stage is always remote-first: never mirror our own screen capture
  // back to us as the full-screen tile. The remote peer's share arrives on the
  // remote video track and is promoted when its share-state signal is active.
  const mainVideo = remoteVideo;
  const pipVideo = localCamera;
  const showingRemoteShare = remoteScreenSharing && Boolean(remoteVideo);

  const statusText =
    phase === 'outgoing'
      ? t('callRinging')
      : phase === 'connecting'
        ? t('callConnecting')
        : connectionState === 'connected'
          ? t('callConnected')
          : t('callConnecting');

  return (
    <div className="voice-call-overlay">
      <div className="voice-call-panel">
        <header className="voice-call-header">
          <div>
            <h2>{remoteUser?.displayName || remoteUser?.username}</h2>
            <p>{statusText}</p>
          </div>
          <div className="voice-call-header-actions">
            <div className="voice-call-header-avatar">
              <AvatarImage
                url={remoteUser?.avatarUrl}
                fallback={remoteUser?.username?.[0] || '?'}
              />
            </div>
            <button type="button" className="voice-call-window-btn" onClick={onMinimize} title="Скрыть окно звонка (звонок продолжится)" aria-label="Скрыть окно звонка; звонок продолжится">
              <FaMinus />
            </button>
          </div>
        </header>

        <div ref={stageRef} className={`voice-call-stage${showingRemoteShare ? ' is-screen-share' : ''}`}>
          {mainVideo || pipVideo ? (
            <>
              <VideoTile
                stream={mainVideo}
                muted
                label={showingRemoteShare ? 'Экран собеседника' : t('callRemoteVideo')}
                className="voice-call-tile--main"
              />
              {showingRemoteShare && (
                <button
                  type="button"
                  className="voice-call-fullscreen-btn"
                  onClick={toggleStageFullscreen}
                  title={stageFullscreen ? 'Вернуть обычный размер' : 'На весь экран'}
                  aria-label={stageFullscreen ? 'Вернуть обычный размер' : 'На весь экран'}
                >
                  {stageFullscreen ? <FaCompress /> : <FaExpand />}
                </button>
              )}
              <VideoTile
                stream={pipVideo}
                muted
                label={t('callYou')}
                className="voice-call-tile--pip"
              />
              {(screenSharing || remoteScreenSharing) && <div className="voice-call-share-badge"><FaDesktop /> {showingRemoteShare ? 'Собеседник показывает экран' : screenSharing ? 'Вы показываете экран · локальный предпросмотр скрыт' : 'Демонстрация экрана'}</div>}
            </>
          ) : (
            <div className="voice-call-audio-only">
              <div className="voice-call-audio-avatar voice-call-audio-avatar--pulse">
                <AvatarImage
                  url={remoteUser?.avatarUrl}
                  fallback={remoteUser?.username?.[0] || '?'}
                />
              </div>
              <p>{statusText}</p>
              <span className="voice-call-audio-caption">Голосовой звонок</span>
            </div>
          )}
        </div>

        {settingsOpen && (
          <div className="voice-call-settings">
            <h3>{t('callScreenSettings')}</h3>
            <label>
              {t('callScreenQuality')}
              <select
                value={screenSettings.quality}
                onChange={(e) => applyScreenSettings({ quality: e.target.value })}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="native">{t('callScreenNative')}</option>
              </select>
            </label>
            <label>
              {t('callScreenFps')}
              <select
                value={String(screenSettings.fps)}
                onChange={(e) => applyScreenSettings({ fps: Number(e.target.value) })}
              >
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="60">60</option>
              </select>
            </label>
            <label className="voice-call-settings-check">
              <input
                type="checkbox"
                checked={screenSettings.withAudio}
                disabled={screenSharing}
                onChange={(e) => applyScreenSettings({ withAudio: e.target.checked })}
              />
              {t('callScreenSystemAudio')}
            </label>
            <p className="voice-call-settings-hint">{screenSharing ? 'Чтобы изменить захват системного звука, останови демонстрацию и запусти её снова.' : t('callScreenHint')}</p>
            <div className="voice-call-settings-divider" />
            <h3 className="voice-call-settings-subtitle">Микрофон</h3>
            <label>
              Устройство ввода
              <select
                value={audioSettings.deviceId || ''}
                onChange={(e) => applyAudioSettings({ deviceId: e.target.value })}
              >
                <option value="">Микрофон по умолчанию</option>
                {microphoneDevices.map((device, index) => (
                  <option key={device.deviceId || device.groupId || index} value={device.deviceId}>
                    {device.label || `Микрофон ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="voice-call-mic-meter" role="meter" aria-label="Уровень сигнала микрофона" aria-valuemin={0} aria-valuemax={100} aria-valuenow={microphoneLevel}>
              <span style={{ width: `${microphoneLevel}%` }} />
            </div>
            <p className="voice-call-settings-hint">Говори в микрофон: индикатор должен реагировать на голос.</p>
            <h3 className="voice-call-settings-subtitle">Обработка микрофона</h3>
            <label className="voice-call-settings-check">
              <input
                type="checkbox"
                checked={audioSettings.noiseSuppression}
                onChange={(e) => applyAudioSettings({ noiseSuppression: e.target.checked })}
              />
              <span>Шумоподавление</span>
            </label>
            <label className="voice-call-settings-check">
              <input
                type="checkbox"
                checked={audioSettings.echoCancellation}
                onChange={(e) => applyAudioSettings({ echoCancellation: e.target.checked })}
              />
              <span>Подавление эха</span>
            </label>
            <label className="voice-call-settings-check">
              <input
                type="checkbox"
                checked={audioSettings.autoGainControl}
                onChange={(e) => applyAudioSettings({ autoGainControl: e.target.checked })}
              />
              <span>Автоматическая громкость микрофона</span>
            </label>
            <p className="voice-call-settings-hint">Если устройство не поддерживает изменение обработки на лету, настройки сохранятся и применятся при следующем звонке.</p>
            <div className="voice-call-settings-divider" />
            <h3 className="voice-call-settings-subtitle">Громкость входящего звука</h3>
            <label className="voice-call-volume-row">
              <span>Собеседник и звук демонстрации</span>
              <strong>{Math.round(remoteVolume * 100)}%</strong>
            </label>
            <input
              className="voice-call-volume-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(remoteVolume * 100)}
              onChange={(e) => onRemoteVolumeChange(Number(e.target.value) / 100)}
              aria-label="Громкость собеседника и демонстрации экрана"
            />
          </div>
        )}

        <div className="voice-call-toolbar">
          <button
            type="button"
            className={`voice-call-tool${muted ? ' is-active' : ''}`}
            onClick={toggleMute}
            title={t('callMute')}
          >
            {muted ? <FaMicrophoneSlash /> : <FaMicrophone />}
          </button>
          <button
            type="button"
            className={`voice-call-tool${deafened ? ' is-active' : ''}`}
            onClick={toggleDeafen}
            title={t('callDeafen')}
          >
            {deafened ? <FaVolumeMute /> : <FaVolumeUp />}
          </button>
          {withVideo && (
            <button
              type="button"
              className={`voice-call-tool${!videoEnabled ? ' is-active' : ''}`}
              onClick={toggleVideo}
              title={t('callVideo')}
            >
              {videoEnabled ? <FaVideo /> : <FaVideoSlash />}
            </button>
          )}
          <button
            type="button"
            className={`voice-call-tool${screenSharing ? ' is-active' : ''}`}
            onClick={toggleScreenShare}
            title={t('callShareScreen')}
          >
            <FaDesktop />
          </button>
          <button
            type="button"
            className={`voice-call-tool${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            title={t('callScreenSettings')}
          >
            <FaCog />
          </button>
          <button type="button" className="voice-call-tool voice-call-tool--hangup" onClick={hangUp} title={t('callHangUp')}>
            <FaPhoneSlash />
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoteAudio({ stream, muted, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.volume = Math.max(0, Math.min(1, volume));
    node.srcObject = muted ? null : stream;
    if (!muted && stream) node.play().catch(() => {});
  }, [stream, muted, volume]);
  return <audio ref={ref} autoPlay playsInline />;
}

export default function VoiceCall() {
  const { phase, errorKey, setErrorKey, remoteStream, deafened, hangUp, remoteUser, connectionState } = useCall();
  const [minimized, setMinimized] = useState(false);
  const [remoteVolume, setRemoteVolume] = useState(() => {
    try {
      const raw = localStorage.getItem('render_call_remote_volume');
      if (raw === null) return 1;
      const stored = Number(raw);
      return Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : 1;
    } catch { return 1; }
  });
  const { t } = useLanguage();

  useEffect(() => {
    try { localStorage.setItem('render_call_remote_volume', String(remoteVolume)); } catch {}
  }, [remoteVolume]);

  useEffect(() => {
    if (!errorKey) return undefined;
    const timer = setTimeout(() => setErrorKey(''), 5000);
    return () => clearTimeout(timer);
  }, [errorKey, setErrorKey]);

  useEffect(() => {
    if (phase === 'idle' || phase === 'incoming') setMinimized(false);
  }, [phase]);

  if (phase === 'idle') {
    return errorKey ? (
      <div className="voice-call-toast" role="status">
        {t(errorKey)}
      </div>
    ) : null;
  }

  return (
    <>
      {errorKey ? (
        <div className="voice-call-toast" role="status">
          {t(errorKey)}
        </div>
      ) : null}
      {phase === 'incoming' && <IncomingCallModal />}
      {(phase === 'outgoing' || phase === 'connecting' || phase === 'active') && (
        minimized ? (
          <div className="voice-call-minimized" role="status">
            <div className="voice-call-minimized-avatar"><AvatarImage url={remoteUser?.avatarUrl} fallback={remoteUser?.displayName?.[0] || remoteUser?.username?.[0] || '?'} /></div>
            <div className="voice-call-minimized-info"><strong>{remoteUser?.displayName || remoteUser?.username || 'Звонок'}</strong><span>{connectionState === 'connected' ? 'На связи' : 'Подключение…'}</span></div>
            <button type="button" className="voice-call-window-btn" onClick={() => setMinimized(false)} title="Открыть окно звонка" aria-label="Открыть окно звонка"><FaExpand /></button>
            <button type="button" className="voice-call-tool voice-call-tool--hangup" onClick={hangUp} title={t('callHangUp')} aria-label={t('callHangUp')}><FaPhoneSlash /></button>
          </div>
        ) : <ActiveCallPanel
          onMinimize={() => setMinimized(true)}
          remoteVolume={remoteVolume}
          onRemoteVolumeChange={setRemoteVolume}
        />
      )}
      {phase !== 'incoming' && <RemoteAudio stream={remoteStream} muted={deafened} volume={remoteVolume} />}
    </>
  );
}

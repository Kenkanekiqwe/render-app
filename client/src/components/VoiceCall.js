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

function ActiveCallPanel({ onMinimize }) {
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
    connectionState,
    hangUp,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
    applyScreenSettings,
  } = useCall();

  const [settingsOpen, setSettingsOpen] = useState(false);

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

        <div className={`voice-call-stage${showingRemoteShare ? ' is-screen-share' : ''}`}>
          {mainVideo || pipVideo ? (
            <>
              <VideoTile
                stream={mainVideo}
                muted={false}
                label={showingRemoteShare ? 'Экран собеседника' : t('callRemoteVideo')}
                className="voice-call-tile--main"
              />
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
                onChange={(e) => applyScreenSettings({ withAudio: e.target.checked })}
              />
              {t('callScreenSystemAudio')}
            </label>
            <p className="voice-call-settings-hint">{t('callScreenHint')}</p>
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

function RemoteAudio({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.srcObject = muted ? null : stream;
    if (!muted && stream) node.play().catch(() => {});
  }, [stream, muted]);
  return <audio ref={ref} autoPlay playsInline />;
}

export default function VoiceCall() {
  const { phase, errorKey, setErrorKey, remoteStream, deafened, hangUp, remoteUser, connectionState } = useCall();
  const [minimized, setMinimized] = useState(false);
  const { t } = useLanguage();

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
        ) : <ActiveCallPanel onMinimize={() => setMinimized(true)} />
      )}
      {phase !== 'incoming' && <RemoteAudio stream={remoteStream} muted={deafened} />}
    </>
  );
}

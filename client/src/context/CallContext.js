import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCallSignaling } from '../utils/callSignaling';
import { CallPeer } from '../utils/webrtcCall';
import { startIncomingCallRing, stopIncomingCallRing, playUiSound } from '../utils/uiSounds';

const CallContext = createContext(null);

function newCallId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeUserId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export function CallProvider({ enabled, children }) {
  const signaling = useMemo(() => getCallSignaling(), []);
  const peerRef = useRef(null);
  const callIdRef = useRef('');
  const remoteUserIdRef = useRef(null);
  const roleRef = useRef(null);
  const phaseRef = useRef('idle');
  const pendingOfferRef = useRef(null);

  const [phase, setPhase] = useState('idle');
  const setPhaseSafe = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const [remoteUser, setRemoteUser] = useState(null);
  const [withVideo, setWithVideo] = useState(true);
  const [incomingWithVideo, setIncomingWithVideo] = useState(true);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [screenSettings, setScreenSettings] = useState(() => {
    const defaults = { quality: '1080p', fps: 30, withAudio: true };
    try {
      const stored = JSON.parse(localStorage.getItem('render_call_screen_settings') || 'null');
      if (!stored || typeof stored !== 'object') return defaults;
      return {
        quality: ['720p', '1080p', '1440p', 'native'].includes(stored.quality)
          ? stored.quality : defaults.quality,
        fps: [15, 30, 60].includes(Number(stored.fps)) ? Number(stored.fps) : defaults.fps,
        withAudio: typeof stored.withAudio === 'boolean' ? stored.withAudio : defaults.withAudio,
      };
    } catch {
      return defaults;
    }
  });
  const [errorKey, setErrorKey] = useState('');

  const markCallActive = useCallback(() => {
    stopIncomingCallRing();
    setPhaseSafe('active');
    setConnectionState('connected');
    playUiSound('play', 0.6);
  }, [setPhaseSafe]);

  const resetCall = useCallback(() => {
    stopIncomingCallRing();
    peerRef.current?.destroy();
    peerRef.current = null;
    callIdRef.current = '';
    remoteUserIdRef.current = null;
    roleRef.current = null;
    pendingOfferRef.current = null;
    setPhaseSafe('idle');
    setRemoteUser(null);
    setMuted(false);
    setDeafened(false);
    setVideoEnabled(true);
    setScreenSharing(false);
    setConnectionState('new');
    setLocalStream(null);
    setRemoteStream(null);
    setScreenStream(null);
    setErrorKey('');
  }, [setPhaseSafe]);

  const hangUp = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) {
      const p = phaseRef.current;
      if (p === 'outgoing') signaling.cancel(callId);
      else if (p === 'incoming') signaling.reject(callId);
      else signaling.end(callId);
    }
    resetCall();
  }, [resetCall, signaling]);

  const attachPeerHandlers = useCallback(
    (peer, callId, remoteUserId) => {
      peer.onRemoteStream = (stream) => {
        setRemoteStream(stream);
      };
      peer.onScreenShareEnded = () => {
        setScreenStream(null);
        setScreenSharing(false);
      };
      peer.onConnectionState = (state) => {
        setConnectionState(state);
        if (state === 'connected') {
          markCallActive();
        }
        if (state === 'failed') {
          setErrorKey('callConnectionLost');
        }
      };
      peer.onIceCandidate = (candidate) => {
        signaling.signal({
          callId,
          toUserId: remoteUserId,
          signalType: 'ice',
          data: candidate,
        });
      };
    },
    [markCallActive, signaling]
  );

  const processRemoteOffer = useCallback(
    async (msg) => {
      const peer = peerRef.current;
      if (!peer?.pc) {
        pendingOfferRef.current = msg;
        return;
      }
      try {
        const answer = await peer.handleRemoteOffer(msg.data);
        signaling.signal({
          callId: callIdRef.current,
          toUserId: normalizeUserId(msg.fromUserId),
          signalType: 'answer',
          data: answer,
        });
        markCallActive();
      } catch {
        setErrorKey('callConnectError');
        hangUp();
      }
    },
    [hangUp, markCallActive, signaling]
  );

  const startOfferFlow = useCallback(
    async (callId, remoteUserId, video) => {
      const ice = signaling.iceServers || undefined;
      const peer = new CallPeer({ iceServers: ice });
      peerRef.current = peer;
      roleRef.current = 'caller';
      remoteUserIdRef.current = remoteUserId;
      callIdRef.current = callId;
      setWithVideo(video);
      setVideoEnabled(video);

      try {
        await peer.initAsCaller(video);
        setLocalStream(peer.getLocalStream());
        attachPeerHandlers(peer, callId, remoteUserId);
        setPhaseSafe('outgoing');
      } catch {
        setErrorKey('callMediaError');
        resetCall();
      }
    },
    [attachPeerHandlers, resetCall, setPhaseSafe, signaling.iceServers]
  );

  const startCall = useCallback(
    async (user, { video = true } = {}) => {
      if (!user?.id || phaseRef.current !== 'idle') return;
      const remoteId = normalizeUserId(user.id);
      if (!remoteId) return;
      setErrorKey('');
      const callId = newCallId();
      callIdRef.current = callId;
      remoteUserIdRef.current = remoteId;
      setRemoteUser(user);
      await startOfferFlow(callId, remoteId, video);
      signaling.invite({ callId, toUserId: remoteId, withVideo: video });
    },
    [signaling, startOfferFlow]
  );

  const acceptCall = useCallback(async () => {
    const callId = callIdRef.current;
    const remoteUserId = remoteUserIdRef.current;
    if (!callId || !remoteUserId || phaseRef.current !== 'incoming') return;

    stopIncomingCallRing();
    setPhaseSafe('connecting');

    const video = incomingWithVideo;
    setWithVideo(video);
    setVideoEnabled(video);

    const ice = signaling.iceServers || undefined;
    const peer = new CallPeer({ iceServers: ice });
    peerRef.current = peer;
    roleRef.current = 'callee';

    try {
      await peer.initAsCallee(video);
      setLocalStream(peer.getLocalStream());
      attachPeerHandlers(peer, callId, remoteUserId);

      const pending = pendingOfferRef.current;
      pendingOfferRef.current = null;

      signaling.accept(callId);

      if (pending) {
        await processRemoteOffer(pending);
      }
    } catch {
      setErrorKey('callMediaError');
      signaling.reject(callId);
      resetCall();
    }
  }, [
    attachPeerHandlers,
    incomingWithVideo,
    processRemoteOffer,
    resetCall,
    setPhaseSafe,
    signaling,
  ]);

  const rejectCall = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) signaling.reject(callId);
    resetCall();
  }, [resetCall, signaling]);

  const actionsRef = useRef({});
  actionsRef.current = {
    resetCall,
    hangUp,
    setPhaseSafe,
    setRemoteUser,
    setIncomingWithVideo,
    markCallActive,
    processRemoteOffer,
    setErrorKey,
  };

  useEffect(() => {
    if (!enabled) {
      signaling.disconnect();
      resetCall();
      return undefined;
    }

    signaling.connect();
    const off = signaling.onMessage(async (msg) => {
      const actions = actionsRef.current;

      switch (msg.type) {
        case 'call-incoming': {
          if (phaseRef.current !== 'idle') return;
          callIdRef.current = msg.callId;
          remoteUserIdRef.current = normalizeUserId(msg.fromUser?.id);
          actions.setRemoteUser(msg.fromUser);
          actions.setIncomingWithVideo(Boolean(msg.withVideo));
          actions.setPhaseSafe('incoming');
          startIncomingCallRing();
          break;
        }
        case 'call-ringing':
          actions.setPhaseSafe('outgoing');
          if (msg.toUser) actions.setRemoteUser(msg.toUser);
          break;
        case 'call-unavailable':
          actions.setErrorKey('callUnavailable');
          actions.resetCall();
          break;
        case 'call-busy':
          actions.setErrorKey(msg.reason === 'peer_busy' ? 'callPeerBusy' : 'callSelfBusy');
          actions.resetCall();
          break;
        case 'call-cancelled':
        case 'call-rejected':
          if (msg.reason === 'declined') actions.setErrorKey('callDeclined');
          actions.resetCall();
          break;
        case 'call-accepted': {
          if (roleRef.current !== 'caller' || !peerRef.current) break;
          actions.setPhaseSafe('connecting');
          try {
            const offer = await peerRef.current.createOffer();
            signaling.signal({
              callId: callIdRef.current,
              toUserId: remoteUserIdRef.current,
              signalType: 'offer',
              data: offer,
            });
          } catch {
            actions.setErrorKey('callConnectError');
            actions.hangUp();
          }
          break;
        }
        case 'call-ended':
          actions.resetCall();
          break;
        case 'signal': {
          if (msg.callId !== callIdRef.current) break;
          if (msg.signalType === 'offer') {
            if (!peerRef.current?.pc) {
              pendingOfferRef.current = msg;
              break;
            }
            await actions.processRemoteOffer(msg);
          } else if (msg.signalType === 'answer') {
            const peer = peerRef.current;
            if (!peer) break;
            try {
              await peer.handleRemoteAnswer(msg.data);
              actions.markCallActive();
            } catch {
              actions.setErrorKey('callConnectError');
              actions.hangUp();
            }
          } else if (msg.signalType === 'ice') {
            peerRef.current?.addIceCandidate(msg.data);
          }
          break;
        }
        default:
          break;
      }
    });

    return () => {
      off();
      if (!enabled) signaling.disconnect();
    };
  }, [enabled, resetCall, signaling]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      peerRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      peerRef.current?.setVideoEnabled(next);
      return next;
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer) return;
    if (screenSharing) {
      await peer.stopScreenShare(true);
      setScreenStream(null);
      setScreenSharing(false);
      return;
    }
    try {
      const stream = await peer.startScreenShare(screenSettings);
      setScreenStream(stream);
      setScreenSharing(true);
    } catch {
      setErrorKey('callScreenError');
    }
  }, [screenSettings, screenSharing]);

  const applyScreenSettings = useCallback((next) => {
    // Display-capture constraints are selected when sharing starts. Updating
    // preferences must not restart capture or reopen the browser source picker.
    setScreenSettings((prev) => {
      const updated = { ...prev, ...next };
      try {
        localStorage.setItem('render_call_screen_settings', JSON.stringify(updated));
      } catch {
        // Keep current-session settings usable if browser storage is unavailable.
      }
      return updated;
    });
  }, []);

  const value = useMemo(
    () => ({
      phase,
      remoteUser,
      withVideo,
      incomingWithVideo,
      muted,
      deafened,
      videoEnabled,
      screenSharing,
      connectionState,
      localStream,
      remoteStream,
      screenStream,
      screenSettings,
      errorKey,
      setErrorKey,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleDeafen,
      toggleVideo,
      toggleScreenShare,
      applyScreenSettings,
    }),
    [
      phase,
      remoteUser,
      withVideo,
      incomingWithVideo,
      muted,
      deafened,
      videoEnabled,
      screenSharing,
      connectionState,
      localStream,
      remoteStream,
      screenStream,
      screenSettings,
      errorKey,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleDeafen,
      toggleVideo,
      toggleScreenShare,
      applyScreenSettings,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within CallProvider');
  }
  return ctx;
}

export function useCallOptional() {
  return useContext(CallContext);
}

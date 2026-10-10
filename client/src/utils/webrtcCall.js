const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const SCREEN_PRESETS = {
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  '1440p': { width: { ideal: 2560 }, height: { ideal: 1440 } },
  native: { width: { ideal: 3840 }, height: { ideal: 2160 } },
};

export function buildAudioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  };
}

export function buildVideoConstraints(enabled) {
  if (!enabled) return false;
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',
  };
}

export function buildScreenConstraints({ quality = '1080p', fps = 30, withAudio = true } = {}) {
  const size = SCREEN_PRESETS[quality] || SCREEN_PRESETS['1080p'];
  return {
    video: {
      ...size,
      frameRate: { ideal: fps, max: fps },
      cursor: 'always',
    },
    audio: withAudio,
    preferCurrentTab: false,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
  };
}

function preferOpus(pc) {
  try {
    const transceivers = pc.getTransceivers?.() || [];
    transceivers.forEach((tr) => {
      if (tr.receiver?.track?.kind !== 'audio') return;
      const caps = RTCRtpSender.getCapabilities?.('audio');
      if (!caps?.codecs?.length) return;
      const opus = caps.codecs.filter(
        (c) => c.mimeType.toLowerCase() === 'audio/opus' || c.mimeType.toLowerCase().includes('opus')
      );
      const rest = caps.codecs.filter((c) => !opus.includes(c));
      if (opus.length && tr.setCodecPreferences) {
        tr.setCodecPreferences([...opus, ...rest]);
      }
    });
  } catch {
    // optional enhancement
  }
}

export class CallPeer {
  constructor({ iceServers = DEFAULT_ICE, onRemoteStream, onConnectionState, onIceCandidate }) {
    this.iceServers = iceServers;
    this.onRemoteStream = onRemoteStream;
    this.onConnectionState = onConnectionState;
    this.onIceCandidate = onIceCandidate;
    this.pc = null;
    this.localStream = null;
    this.screenStream = null;
    this.screenSender = null;
    this.screenAudioSender = null;
    this.videoSender = null;
    this.isCaller = false;
    this.withVideo = false;
    this.remoteMediaStream = null;
    this.pendingIceCandidates = [];
    this.hasRemoteDescription = false;
  }

  async initAsCaller(withVideo) {
    this.isCaller = true;
    this.withVideo = withVideo;
    await this.ensureLocalMedia(withVideo);
    this.createPeerConnection();
  }

  async initAsCallee(withVideo) {
    this.isCaller = false;
    this.withVideo = withVideo;
    await this.ensureLocalMedia(withVideo);
    this.createPeerConnection();
  }

  async ensureLocalMedia(withVideo) {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(),
      video: buildVideoConstraints(withVideo),
    });
    return this.localStream;
  }

  createPeerConnection() {
    if (this.pc) {
      this.pc.close();
    }
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.localStream.getTracks().forEach((track) => {
      const sender = this.pc.addTrack(track, this.localStream);
      if (track.kind === 'video') this.videoSender = sender;
    });

    // Negotiate a video sender even for voice-only calls, so screen sharing
    // can start without a second SDP negotiation after the call is connected.
    if (!this.videoSender) {
      this.videoSender = this.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }
    // Pre-negotiate a sender for optional system audio as well.
    this.screenAudioSender = this.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;

    // Keep one stable remote stream. With pre-negotiated transceivers,
    // audio and video can arrive with different/empty event.streams arrays;
    // replacing the stream on every ontrack event drops the other media kind.
    this.remoteMediaStream = new MediaStream();
    this.pc.ontrack = (event) => {
      const stream = this.remoteMediaStream;
      if (event.track && !stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      const notifyTrackState = () => this.onRemoteStream?.(stream, event.track);
      event.track?.addEventListener('unmute', notifyTrackState);
      event.track?.addEventListener('mute', notifyTrackState);
      event.track?.addEventListener('ended', () => {
        try {
          stream.removeTrack(event.track);
        } catch {
          // The peer may already be closing.
        }
        notifyTrackState();
      }, { once: true });
      if (this.onRemoteStream) this.onRemoteStream(stream, event.track);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    const emitState = () => {
      if (!this.onConnectionState || !this.pc) return;
      const state = this.pc.connectionState;
      const ice = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed' || ice === 'connected' || ice === 'completed') {
        this.onConnectionState('connected');
        return;
      }
      this.onConnectionState(state);
    };

    this.pc.onconnectionstatechange = emitState;
    this.pc.oniceconnectionstatechange = emitState;

    preferOpus(this.pc);
  }

  async flushPendingCandidates() {
    if (!this.pc || !this.pendingIceCandidates.length) return;
    const pending = [...this.pendingIceCandidates];
    this.pendingIceCandidates = [];
    await Promise.all(
      pending.map((candidate) =>
        this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
      )
    );
  }

  markRemoteDescriptionSet() {
    this.hasRemoteDescription = true;
    return this.flushPendingCandidates();
  }

  getLocalStream() {
    return this.localStream;
  }

  getScreenStream() {
    return this.screenStream;
  }

  setMuted(muted) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setVideoEnabled(enabled) {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription || offer;
  }

  async handleRemoteOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.markRemoteDescriptionSet();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription || answer;
  }

  async handleRemoteAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.markRemoteDescriptionSet();
  }

  async addIceCandidate(candidate) {
    if (!candidate || !this.pc) return;
    if (!this.hasRemoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      this.pendingIceCandidates.push(candidate);
    }
  }

  async startScreenShare(settings) {
    await this.stopScreenShare(false);
    this.screenStream = await navigator.mediaDevices.getDisplayMedia(
      buildScreenConstraints(settings)
    );

    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      this.stopScreenShare();
      throw new Error('no_screen_track');
    }

    videoTrack.onended = async () => {
      await this.stopScreenShare();
      this.onScreenShareEnded?.();
    };

    const audioTrack = this.screenStream.getAudioTracks()[0];
    const sender = this.videoSender || this.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) {
      await this.stopScreenShare();
      throw new Error('no_video_sender');
    }
    await sender.replaceTrack(videoTrack);
    this.screenSender = sender;

    if (this.screenAudioSender) {
      await this.screenAudioSender.replaceTrack(audioTrack || null);
    }

    this.setVideoEnabled(false);
    return this.screenStream;
  }

  async stopScreenShare(restoreCamera = true) {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    const camTrack = this.localStream?.getVideoTracks()[0];
    if (this.screenSender && camTrack) {
      try {
        await this.screenSender.replaceTrack(restoreCamera && this.withVideo ? camTrack : null);
      } catch {
        // sender may be gone
      }
    }
    this.screenSender = null;
    if (this.screenAudioSender) {
      try {
        await this.screenAudioSender.replaceTrack(null);
      } catch {
        // Peer connection may already be closed.
      }
    }

    if (restoreCamera && this.withVideo) {
      this.setVideoEnabled(true);
    }
  }

  async applyScreenSettings(settings) {
    if (!this.screenStream) return this.startScreenShare(settings);
    return this.startScreenShare(settings);
  }

  destroy() {
    this.stopScreenShare(false).catch(() => {});
    this.remoteMediaStream = null;
    this.pendingIceCandidates = [];
    this.hasRemoteDescription = false;
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

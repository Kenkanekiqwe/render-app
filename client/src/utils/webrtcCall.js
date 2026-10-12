import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const SCREEN_PRESETS = {
  '720p': { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
  '1080p': { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
  '1440p': { width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 } },
  native: { width: { ideal: 3840 }, height: { ideal: 2160 } },
};

export function buildAudioConstraints({ echoCancellation = true, noiseSuppression = true, autoGainControl = true, deviceId = '' } = {}) {
  return {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
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
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  };
}

function getScreenBitrate(settings = {}) {
  const base = {
    '720p': 2500000,
    '1080p': 5000000,
    '1440p': 8000000,
    native: 12000000,
  }[settings.quality] || 5000000;
  const fpsScale = Math.min(2, Math.max(0.5, (Number(settings.fps) || 30) / 30));
  return Math.round(base * fpsScale);
}

function getScreenTrackConstraints(settings = {}) {
  const constraints = {
    frameRate: { ideal: Number(settings.fps) || 30, max: Number(settings.fps) || 30 },
  };
  const preset = SCREEN_PRESETS[settings.quality] || SCREEN_PRESETS['1080p'];
  if (settings.quality !== 'native') {
    constraints.width = preset.width;
    constraints.height = preset.height;
  }
  return constraints;
}

async function applyScreenSenderQuality(sender, settings = {}) {
  if (!sender) return;
  try {
    const parameters = sender.getParameters();
    if (parameters.encodings?.length) {
      parameters.encodings = parameters.encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: getScreenBitrate(settings),
        maxFramerate: Number(settings.fps) || 30,
      }));
      await sender.setParameters(parameters);
    }
  } catch {
    // Browser may not expose writable sender encoding parameters.
  }
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
    this.audioDeviceId = '';
    this.audioSender = null;
    this.rawAudioTrack = null;
    this.audioPipeline = null;
    this.audioContext = null;
    this.rnnoiseWasmBinary = null;
    this.rnnoiseLoadPromise = null;
    this.rnnoiseModuleLoaded = false;
  }

  async initAsCaller(withVideo, audioSettings) {
    this.isCaller = true;
    this.withVideo = withVideo;
    await this.ensureLocalMedia(withVideo, audioSettings);
    this.createPeerConnection();
  }

  async initAsCallee(withVideo, audioSettings) {
    this.isCaller = false;
    this.withVideo = withVideo;
    await this.ensureLocalMedia(withVideo, audioSettings);
    this.createPeerConnection();
  }

  getDspAssetUrl(name) {
    const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL
      ? process.env.PUBLIC_URL.replace(/\/$/, '')
      : '';
    return `${base}/audio-dsp/${name}`;
  }

  async createAudioOutputTrack(rawTrack, settings = {}) {
    if (!settings.noiseSuppression || !rawTrack) {
      return { track: rawTrack, cleanup: () => {}, rnnoise: false };
    }

    try {
      if (!this.rnnoiseLoadPromise) {
        this.rnnoiseLoadPromise = loadRnnoise({
          url: this.getDspAssetUrl('rnnoise.wasm'),
          simdUrl: this.getDspAssetUrl('rnnoise_simd.wasm'),
        }).then((binary) => {
          this.rnnoiseWasmBinary = binary;
          return binary;
        }).catch((error) => {
          this.rnnoiseLoadPromise = null;
          throw error;
        });
      }
      const wasmBinary = await this.rnnoiseLoadPromise;
      if (!this.audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('AudioWorklet is not supported');
        this.audioContext = new AudioContextClass({ sampleRate: 48000 });
      }
      const context = this.audioContext;
      if (!context.audioWorklet) throw new Error('AudioWorklet is not supported');
      if (!this.rnnoiseModuleLoaded) {
        await context.audioWorklet.addModule(this.getDspAssetUrl('rnnoiseWorklet.js'));
        this.rnnoiseModuleLoaded = true;
      }
      await context.resume();

      const source = context.createMediaStreamSource(new MediaStream([rawTrack]));
      const processor = new RnnoiseWorkletNode(context, {
        wasmBinary,
        maxChannels: 1,
      });
      const destination = context.createMediaStreamDestination();
      source.connect(processor);
      processor.connect(destination);
      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) throw new Error('RNNoise did not create an output track');

      return {
        track: processedTrack,
        rnnoise: true,
        cleanup: () => {
          try { source.disconnect(); } catch {}
          try { processor.destroy?.(); } catch {}
          try { processor.disconnect(); } catch {}
          destination.stream.getTracks().forEach((track) => track.stop());
        },
      };
    } catch (error) {
      // Fall back to the browser's own noise suppression if WASM/AudioWorklet
      // cannot start on this browser or device.
      try { await rawTrack.applyConstraints({ noiseSuppression: true }); } catch {}
      console.warn('[call] RNNoise unavailable; using browser noise suppression:', error);
      return { track: rawTrack, cleanup: () => {}, rnnoise: false };
    }
  }

  async ensureLocalMedia(withVideo, audioSettings) {
    if (this.localStream) this.localStream.getTracks().forEach((track) => track.stop());
    this.audioPipeline?.cleanup?.();
    this.audioDeviceId = audioSettings?.deviceId || '';
    const captureStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints({ ...audioSettings, noiseSuppression: false }),
      video: buildVideoConstraints(withVideo),
    });
    this.rawAudioTrack = captureStream.getAudioTracks()[0] || null;
    this.audioPipeline = await this.createAudioOutputTrack(this.rawAudioTrack, audioSettings);
    this.localStream = new MediaStream();
    if (this.audioPipeline.track) this.localStream.addTrack(this.audioPipeline.track);
    captureStream.getVideoTracks().forEach((track) => this.localStream.addTrack(track));
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
      if (track.kind === 'audio') this.audioSender = sender;
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
    this.remoteScreenAudioStream = new MediaStream();
    this.pc.ontrack = (event) => {
      const screenAudioMid = this.pc?.getTransceivers?.()
        .find((item) => item.sender === this.screenAudioSender)?.mid;
      const isScreenAudio = event.track?.kind === 'audio'
        && screenAudioMid != null
        && event.transceiver?.mid === screenAudioMid;
      const stream = isScreenAudio ? this.remoteScreenAudioStream : this.remoteMediaStream;
      if (event.track && !stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      const notifyTrackState = () => this.onRemoteStream?.(stream, event.track, isScreenAudio);
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
      if (this.onRemoteStream) this.onRemoteStream(stream, event.track, isScreenAudio);
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

  async applyAudioSettings(settings = {}) {
    const currentTrack = this.localStream?.getAudioTracks?.()[0];
    if (!currentTrack || !navigator.mediaDevices?.getUserMedia) return;

    const selectedDeviceId = settings.deviceId || '';
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints({ ...settings, noiseSuppression: false }),
      video: false,
    });
    const replacementRawTrack = replacementStream.getAudioTracks()[0];
    if (!replacementRawTrack) {
      replacementStream.getTracks().forEach((track) => track.stop());
      throw new Error('Selected microphone did not provide an audio track');
    }

    let replacementPipeline;
    try {
      replacementPipeline = await this.createAudioOutputTrack(replacementRawTrack, settings);
      if (this.audioSender) await this.audioSender.replaceTrack(replacementPipeline.track);
    } catch (error) {
      replacementPipeline?.cleanup?.();
      replacementStream.getTracks().forEach((track) => track.stop());
      throw error;
    }

    this.localStream.removeTrack(currentTrack);
    this.localStream.addTrack(replacementPipeline.track);
    if (this.audioPipeline?.track && this.audioPipeline.track !== this.rawAudioTrack) {
      this.audioPipeline.cleanup?.();
    }
    if (this.rawAudioTrack && this.rawAudioTrack !== replacementPipeline.track) {
      this.rawAudioTrack.stop();
    }
    currentTrack.stop();
    this.rawAudioTrack = replacementRawTrack;
    this.audioPipeline = replacementPipeline;
    this.audioDeviceId = selectedDeviceId;
    this.lastAudioTrackSettings = replacementRawTrack.getSettings?.() || {};
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
    if (!sender || !this.pc || this.pc.signalingState === 'closed') {
      await this.stopScreenShare();
      throw new Error('no_video_sender');
    }

    // Keep the negotiated sender stable, but force it to send the desktop track.
    // Apply capture constraints where the browser permits and tune the encoder.
    try { videoTrack.contentHint = 'detail'; } catch { /* optional browser hint */ }
    const transceiver = this.pc.getTransceivers().find((item) => item.sender === sender);
    if (transceiver && transceiver.direction !== 'sendrecv') {
      transceiver.direction = 'sendrecv';
    }
    await sender.replaceTrack(videoTrack);
    this.screenSender = sender;
    try {
      await videoTrack.applyConstraints(getScreenTrackConstraints(settings));
    } catch {
      // A browser may lock display capture to the source's native dimensions.
    }
    await applyScreenSenderQuality(sender, settings);

    if (this.screenAudioSender) {
      await this.screenAudioSender.replaceTrack(audioTrack || null);
    }

    // Keep the local camera track enabled for the user's own picture-in-picture.
    // replaceTrack sends the desktop capture; it does not require disabling the camera.
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
    const track = this.screenStream?.getVideoTracks?.()[0];
    if (!track || track.readyState !== 'live') return false;
    try {
      await track.applyConstraints(getScreenTrackConstraints(settings));
    } catch {
      // Resolution constraints are advisory for display capture in some browsers.
    }
    await applyScreenSenderQuality(this.screenSender, settings);
    return true;
  }

  destroy() {
    this.stopScreenShare(false).catch(() => {});
    this.remoteMediaStream = null;
    this.pendingIceCandidates = [];
    this.hasRemoteDescription = false;
    this.audioPipeline?.cleanup?.();
    this.audioPipeline = null;
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.rawAudioTrack && this.rawAudioTrack.readyState !== 'ended') {
      this.rawAudioTrack.stop();
    }
    this.rawAudioTrack = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

/**
 * WebRTC for live classes. Plain JavaScript, no React, so it is easy to reason about and test.
 *
 * Topology: the instructor keeps one connection per student ("star"). Students only receive. They ask questions
 * through chat and raised hands, which also means a student can never broadcast anything to the class.
 *
 * Signalling (offers, answers, ICE candidates) travels over the authenticated Socket.IO connection. The server
 * relays only instructor<->student messages and validates every one (see server/src/lib/liveHub.js).
 */

const CAMERA_BITRATE = 800_000; // bits per second, per student connection
const SCREEN_BITRATE = 1_500_000; // text and code need more detail than a face does

const sendSignal = (socket, to, data) => socket.emit('live:signal', { to, data });

/** Turns a getUserMedia/getDisplayMedia failure into something a person can act on. */
export function describeMediaError(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permission was blocked. Allow camera and microphone access in your browser, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera or microphone is being used by another app. Close it and try again.';
    default:
      return 'Could not start your camera or microphone.';
  }
}

export const mediaSupported = () =>
  typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

async function tune(sender, bitrate, screen) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bitrate;
    if (screen) params.degradationPreference = 'maintain-resolution'; // drop frame rate before legibility
    await sender.setParameters(params);
  } catch {
    /* not supported by this browser: the default adaptive bitrate still works */
  }
}

/* ======================= Instructor side ======================= */

export class Broadcaster {
  constructor({ socket, iceServers, onPeers }) {
    this.socket = socket;
    this.iceServers = iceServers || [];
    this.onPeers = onPeers || (() => {});
    this.peers = new Map(); // viewer socketId -> { pc, audio, video, queue }
    this.tracks = { audio: null, video: null };
    this.screen = false;
  }

  /** Creates a connection to one student and sends them an offer. Safe to call again to rebuild a broken one. */
  async addViewer(viewerId) {
    this.removeViewer(viewerId, false);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // Fixed audio + video slots, so tracks can be swapped later with replaceTrack and no renegotiation.
    const audio = pc.addTransceiver('audio', { direction: 'sendonly' }).sender;
    const video = pc.addTransceiver('video', { direction: 'sendonly' }).sender;
    const peer = { pc, audio, video, queue: [] };
    this.peers.set(viewerId, peer);

    pc.onicecandidate = (e) => {
      if (this.peers.get(viewerId) !== peer) return;
      sendSignal(this.socket, viewerId, { type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = () => this.onPeers(this.peerStates());

    if (this.tracks.audio) await audio.replaceTrack(this.tracks.audio);
    if (this.tracks.video) await video.replaceTrack(this.tracks.video);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.peers.get(viewerId) !== peer) return; // replaced or removed while negotiating
    sendSignal(this.socket, viewerId, { type: 'offer', sdp: pc.localDescription.sdp });
    tune(video, this.screen ? SCREEN_BITRATE : CAMERA_BITRATE, this.screen);
    this.onPeers(this.peerStates());
  }

  removeViewer(viewerId, notify = true) {
    const peer = this.peers.get(viewerId);
    if (!peer) return;
    this.peers.delete(viewerId);
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (notify) this.onPeers(this.peerStates());
  }

  async handleSignal(from, data) {
    const peer = this.peers.get(from);
    if (!peer) return;
    try {
      if (data.type === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const c of peer.queue.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      } else if (data.type === 'candidate' && data.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.queue.push(data.candidate);
      }
    } catch {
      /* a stale message for a connection we already replaced */
    }
  }

  /** Swap what everyone sees/hears. Pass null to stop sending that kind. `screen` tunes the video for legibility. */
  async setTracks({ audio, video, screen }) {
    if (audio !== undefined) this.tracks.audio = audio;
    if (video !== undefined) this.tracks.video = video;
    if (screen !== undefined) this.screen = screen;
    if (this.tracks.video && 'contentHint' in this.tracks.video) this.tracks.video.contentHint = this.screen ? 'detail' : 'motion';
    await Promise.all(
      [...this.peers.values()].map(async (p) => {
        if (audio !== undefined) await p.audio.replaceTrack(this.tracks.audio).catch(() => {});
        if (video !== undefined) await p.video.replaceTrack(this.tracks.video).catch(() => {});
        if (video !== undefined || screen !== undefined) tune(p.video, this.screen ? SCREEN_BITRATE : CAMERA_BITRATE, this.screen);
      })
    );
  }

  peerStates() {
    const out = {};
    this.peers.forEach((p, id) => (out[id] = p.pc.connectionState));
    return out;
  }

  close() {
    [...this.peers.keys()].forEach((id) => this.removeViewer(id, false));
  }
}

/* ======================= Student side ======================= */

export class Receiver {
  constructor({ socket, iceServers, onStream, onState, onVideoActive }) {
    this.socket = socket;
    this.iceServers = iceServers || [];
    this.onStream = onStream || (() => {});
    this.onState = onState || (() => {});
    this.onVideoActive = onVideoActive || (() => {});
    this.pc = null;
    this.hostId = null;
    this.queue = [];
    this.stream = new MediaStream(); // audio and video tracks are collected here for one <video> element
    this.lastRequest = 0;
    this.recoverTimer = null;
  }

  /** Called for every message from the instructor. A new offer always replaces the old connection. */
  async handleSignal(from, data) {
    try {
      if (data.type === 'offer') await this.#answer(from, data.sdp);
      else if (data.type === 'candidate' && from === this.hostId && data.candidate) {
        if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate).catch(() => {});
        else this.queue.push(data.candidate);
      }
    } catch {
      this.requestOffer();
    }
  }

  async #answer(from, sdp) {
    this.#closePc();
    this.hostId = from;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;

    pc.ontrack = (e) => {
      // Keep only the newest track of each kind
      this.stream.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => this.stream.removeTrack(t));
      this.stream.addTrack(e.track);
      if (e.track.kind === 'video') {
        // A muted remote video track means the instructor currently sends no picture (camera off)
        e.track.onmute = () => this.onVideoActive(false);
        e.track.onunmute = () => this.onVideoActive(true);
        this.onVideoActive(!e.track.muted);
      }
      this.onStream(this.stream);
    };
    pc.onicecandidate = (e) => {
      if (this.pc === pc) sendSignal(this.socket, this.hostId, { type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      this.onState(s);
      clearTimeout(this.recoverTimer);
      if (s === 'failed') this.requestOffer();
      // "disconnected" often heals itself within seconds; if it does not, ask for a fresh connection
      if (s === 'disconnected') this.recoverTimer = setTimeout(() => this.pc === pc && pc.connectionState !== 'connected' && this.requestOffer(), 5000);
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const c of this.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(this.socket, from, { type: 'answer', sdp: pc.localDescription.sdp });
    this.onState('connecting');
  }

  /** Ask the instructor to start over with us. Rate limited here and on the server. */
  requestOffer() {
    const now = Date.now();
    if (now - this.lastRequest < 4000) return;
    this.lastRequest = now;
    this.socket.emit('live:request-offer');
  }

  #closePc() {
    clearTimeout(this.recoverTimer);
    if (!this.pc) return;
    this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.pc = null;
    this.queue = [];
  }

  close() {
    this.#closePc();
    this.stream.getTracks().forEach((t) => this.stream.removeTrack(t));
  }
}

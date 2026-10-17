/**
 * Pure rules for live sessions. No I/O, so every security decision here is unit-tested.
 */

const MAX_SIGNAL_BYTES = 32 * 1024;
const MAX_SDP_CHARS = 24 * 1024;
const MAX_CHAT_CHARS = 500;
const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate']);

/**
 * Validates and re-builds a WebRTC signalling payload. Only known fields are kept, so a client
 * cannot use the signalling channel to smuggle arbitrary data to other participants.
 */
function validateSignal(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'shape' };
  if (!SIGNAL_TYPES.has(data.type)) return { ok: false, reason: 'type' };

  let size;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return { ok: false, reason: 'shape' };
  }
  if (size > MAX_SIGNAL_BYTES) return { ok: false, reason: 'size' };

  if (data.type === 'offer' || data.type === 'answer') {
    if (typeof data.sdp !== 'string' || data.sdp.length === 0 || data.sdp.length > MAX_SDP_CHARS) {
      return { ok: false, reason: 'sdp' };
    }
    return { ok: true, data: { type: data.type, sdp: data.sdp } };
  }

  // ICE candidate (null marks "no more candidates")
  if (data.candidate === null) return { ok: true, data: { type: 'candidate', candidate: null } };
  const c = data.candidate;
  if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 2000) {
    return { ok: false, reason: 'candidate' };
  }
  const clean = { candidate: c.candidate };
  if (typeof c.sdpMid === 'string' && c.sdpMid.length <= 64) clean.sdpMid = c.sdpMid;
  if (c.sdpMid === null) clean.sdpMid = null;
  if (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 64) clean.sdpMLineIndex = c.sdpMLineIndex;
  if (c.sdpMLineIndex === null) clean.sdpMLineIndex = null;
  if (typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 64) clean.usernameFragment = c.usernameFragment;
  return { ok: true, data: { type: 'candidate', candidate: clean } };
}

/** Trims chat text, removes control characters, and rejects empty or oversized messages. */
function cleanChatText(text) {
  if (typeof text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!cleaned || cleaned.length > MAX_CHAT_CHARS) return null;
  return cleaned;
}

/** Token bucket: `capacity` events at once, refilling `refillPerSec` per second. */
function createBucket({ capacity, refillPerSec, now = () => Date.now() }) {
  let tokens = capacity;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/**
 * Who may join a session. Enrolment is the gate: a student who has not registered for the course is refused.
 * The instructor who started the session and admins never need to be enrolled.
 */
function canJoin({ sessionStatus, isHost, isAdmin, isEnrolled, removed, viewerCount, maxViewers }) {
  if (sessionStatus !== 'live') return { ok: false, code: 'ended', reason: 'This live session has ended.' };
  if (!isHost && !isAdmin && !isEnrolled) {
    return { ok: false, code: 'not_enrolled', reason: 'Only students enrolled in this course can join its live sessions.' };
  }
  if (removed && !isHost) return { ok: false, code: 'removed', reason: 'The instructor removed you from this session.' };
  if (!isHost && viewerCount >= maxViewers) {
    return { ok: false, code: 'full', reason: 'This session is full.' };
  }
  return { ok: true };
}

/** Star topology: media only flows between the instructor and a viewer, never viewer to viewer. */
function canSignal(senderRole, targetRole) {
  return (senderRole === 'host' && targetRole === 'viewer') || (senderRole === 'viewer' && targetRole === 'host');
}

module.exports = {
  MAX_SIGNAL_BYTES,
  MAX_CHAT_CHARS,
  validateSignal,
  cleanChatText,
  createBucket,
  canJoin,
  canSignal,
};

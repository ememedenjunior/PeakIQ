const crypto = require('crypto');
const { validateSignal, cleanChatText, createBucket, canJoin, canSignal } = require('./liveRules');
const { isObjectId } = require('./validate');

const room = (sessionId) => `live:${sessionId}`;
const userRoom = (userId) => `user:${userId}`;

const BUCKETS = {
  signal: { capacity: 80, refillPerSec: 30 }, // ICE candidates arrive in bursts
  chat: { capacity: 5, refillPerSec: 0.5 },
  hand: { capacity: 4, refillPerSec: 0.5 },
  join: { capacity: 6, refillPerSec: 0.2 },
  control: { capacity: 10, refillPerSec: 1 },
};

/**
 * Live class coordinator.
 *
 * Every rule that matters is enforced HERE, on the server, on every event: the client is never trusted.
 *  - Only enrolled students (plus the instructor who started the session, and admins) can join.
 *  - Only the instructor can moderate (kick, toggle chat, lower hands).
 *  - WebRTC signalling only flows instructor <-> viewer, never viewer <-> viewer.
 *
 * State lives in memory (one API instance). The database holds the durable facts: session, status, attendance.
 */
function createLiveHub({ io, store, config, log = console, timers = { setTimeout, clearTimeout } }) {
  const states = new Map(); // sessionId -> state

  const logError = (err) => log.error('[live]', err);

  /* ---------- state ---------- */

  function startGrace(st) {
    clearGrace(st);
    st.graceTimer = timers.setTimeout(() => endSession(st.id, 'host_left').catch(logError), config.live.hostGraceSeconds * 1000);
    st.graceTimer?.unref?.();
  }

  function clearGrace(st) {
    if (st.graceTimer) timers.clearTimeout(st.graceTimer);
    st.graceTimer = null;
  }

  function ensureState(session) {
    let st = states.get(session.id);
    if (st) return st;
    st = {
      id: session.id,
      course: session.course,
      hostId: session.host,
      hostSocketId: null,
      viewers: new Map(), // userId -> { socketId, name, joinedAt }
      members: new Map(), // socketId -> { userId, role, name }
      hands: new Set(),
      chat: [],
      chatEnabled: session.chatEnabled !== false,
      removed: new Set(session.removed || []),
      peak: session.peakViewers || 0,
      graceTimer: null,
      maxTimer: null,
    };
    states.set(session.id, st);
    startGrace(st); // an instructor who never connects does not leave a ghost session behind
    st.maxTimer = timers.setTimeout(() => endSession(st.id, 'max_duration').catch(logError), config.live.maxHours * 3600 * 1000);
    st.maxTimer?.unref?.();
    return st;
  }

  const viewerList = (st) =>
    [...st.viewers.entries()].map(([userId, v]) => ({ socketId: v.socketId, userId, name: v.name, hand: st.hands.has(userId) }));

  /** Removes one connection from the session's state. `silent` skips the "instructor offline" side effects (used when replacing). */
  function purgeMember(st, socketId, { silent = false } = {}) {
    const member = st.members.get(socketId);
    if (!member) return;
    st.members.delete(socketId);

    if (member.role === 'host') {
      if (st.hostSocketId !== socketId) return;
      st.hostSocketId = null;
      if (!silent) {
        io.to(room(st.id)).emit('live:host-status', { online: false });
        startGrace(st);
      }
      return;
    }

    const viewer = st.viewers.get(member.userId);
    if (!viewer || viewer.socketId !== socketId) return;
    st.viewers.delete(member.userId);
    st.hands.delete(member.userId);
    store.recordLeave(st.id, member.userId, Math.max(0, Math.round((Date.now() - viewer.joinedAt) / 1000))).catch(logError);
    io.to(room(st.id)).emit('live:count', { viewers: st.viewers.size });
    if (st.hostSocketId) io.to(st.hostSocketId).emit('live:viewer-left', { socketId, userId: member.userId });
  }

  function detach(socket, opts) {
    const meta = socket.data.live;
    if (!meta) return;
    socket.data.live = null;
    try {
      socket.leave(room(meta.sessionId));
    } catch {
      /* already disconnected */
    }
    const st = states.get(meta.sessionId);
    if (st) purgeMember(st, socket.id, opts);
  }

  /* ---------- announcements to people who are not in the room ---------- */

  function emitToUsers(userIds, event, payload) {
    for (let i = 0; i < userIds.length; i += 500) {
      io.to(userIds.slice(i, i + 500).map(userRoom)).emit(event, payload);
    }
  }

  async function announceStarted(session, courseTitle) {
    const userIds = await store.listEnrolledUserIds(session.course);
    const payload = { id: session.id, courseId: session.course, courseTitle, title: session.title, startedAt: session.startedAt };
    emitToUsers(userIds, 'live:started', payload);
    const docs = await store.createLiveNotifications(userIds, {
      title: 'Live class started',
      message: `${session.title} is live now. Join in.`,
      link: `/live/${session.id}`,
    });
    for (const doc of docs) io.to(userRoom(doc.user)).emit('notification', doc);
  }

  async function announceEnded(session) {
    const userIds = await store.listEnrolledUserIds(session.course);
    emitToUsers([...userIds, session.host], 'live:ended', { id: session.id, courseId: session.course });
  }

  /* ---------- lifecycle ---------- */

  async function endSession(sessionId, reason = 'host_ended') {
    const st = states.get(sessionId);
    if (st) {
      clearGrace(st);
      if (st.maxTimer) timers.clearTimeout(st.maxTimer);
      states.delete(sessionId); // first, so a racing timer cannot end it twice
    }

    const ended = await store.markEnded(sessionId, { reason, peakViewers: st ? st.peak : undefined });
    if (!ended) return false; // it had already ended

    if (st) {
      io.to(room(sessionId)).emit('live:ended', { reason });
      const now = Date.now();
      for (const [userId, viewer] of st.viewers) {
        store.recordLeave(sessionId, userId, Math.max(0, Math.round((now - viewer.joinedAt) / 1000))).catch(logError);
      }
      for (const socketId of st.members.keys()) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
          sock.data.live = null;
          sock.leave(room(sessionId));
        }
      }
    }
    await announceEnded(ended).catch(logError);
    return true;
  }

  /** After a restart, sessions still marked live get a grace window for the instructor to reconnect. */
  async function recover() {
    const sessions = await store.listLiveSessions();
    sessions.forEach(ensureState);
    return sessions.length;
  }

  function shutdown() {
    for (const st of states.values()) {
      clearGrace(st);
      if (st.maxTimer) timers.clearTimeout(st.maxTimer);
    }
    states.clear();
  }

  /* ---------- socket events ---------- */

  const bucketFor = (socket, name) => {
    socket.data.buckets ||= {};
    return (socket.data.buckets[name] ||= createBucket(BUCKETS[name]));
  };

  /** Resolves the caller's session state and role, or null when they are not in a session. */
  function context(socket) {
    const meta = socket.data.live;
    if (!meta) return null;
    const st = states.get(meta.sessionId);
    if (!st) return null;
    const member = st.members.get(socket.id);
    return member ? { st, member } : null;
  }

  async function handleJoin(socket, payload) {
    if (!bucketFor(socket, 'join').take()) return { ok: false, code: 'rate', error: 'Too many attempts. Wait a moment.' };

    const user = socket.data.user;
    const sessionId = String(payload?.sessionId ?? '');
    if (!isObjectId(sessionId)) return { ok: false, code: 'not_found', error: 'Live session not found.' };

    const session = await store.getSession(sessionId);
    if (!session) return { ok: false, code: 'not_found', error: 'Live session not found.' };

    const isHost = session.host === user.id;
    const isAdmin = user.role === 'admin';
    const isEnrolled = isHost || isAdmin ? true : await store.isEnrolled(user.id, session.course);

    const live = session.status === 'live';
    const st = live ? ensureState(session) : null;
    // Do not count the person's own older connection against the limit: it is about to be replaced.
    const others = st ? [...st.viewers.keys()].filter((id) => id !== user.id).length : 0;

    const verdict = canJoin({
      sessionStatus: session.status,
      isHost,
      isAdmin,
      isEnrolled,
      removed: st ? st.removed.has(user.id) : (session.removed || []).includes(user.id),
      viewerCount: others,
      maxViewers: config.live.maxViewers,
    });
    if (!verdict.ok) return { ok: false, code: verdict.code, error: verdict.reason };

    // One connection per person: opening a second tab replaces the first instead of doubling the load on the instructor.
    if (socket.data.live) detach(socket, { silent: socket.data.live.sessionId === sessionId });
    const previous = isHost ? st.hostSocketId : st.viewers.get(user.id)?.socketId;
    if (previous && previous !== socket.id) {
      const old = io.sockets.sockets.get(previous);
      if (old) {
        old.emit('live:replaced');
        detach(old, { silent: true });
      } else {
        purgeMember(st, previous, { silent: true });
      }
    }

    socket.join(room(sessionId));
    const role = isHost ? 'host' : 'viewer';
    socket.data.live = { sessionId, role };
    st.members.set(socket.id, { userId: user.id, role, name: user.name });

    if (isHost) {
      st.hostSocketId = socket.id;
      clearGrace(st);
      io.to(room(sessionId)).emit('live:host-status', { online: true });
    } else {
      st.viewers.set(user.id, { socketId: socket.id, name: user.name, joinedAt: Date.now() });
      st.peak = Math.max(st.peak, st.viewers.size);
      store.recordJoin(sessionId, user.id).catch(logError);
      if (st.hostSocketId) {
        io.to(st.hostSocketId).emit('live:viewer-joined', { socketId: socket.id, user: { id: user.id, name: user.name } });
      }
      io.to(room(sessionId)).emit('live:count', { viewers: st.viewers.size });
    }

    return {
      ok: true,
      role,
      socketId: socket.id,
      hostOnline: !!st.hostSocketId,
      viewerCount: st.viewers.size,
      chatEnabled: st.chatEnabled,
      chat: st.chat.slice(-50),
      ...(isHost ? { peers: viewerList(st) } : {}),
    };
  }

  function handleSignal(socket, msg) {
    const ctx = context(socket);
    if (!ctx || !bucketFor(socket, 'signal').take()) return;
    const to = typeof msg?.to === 'string' ? msg.to : '';
    const target = ctx.st.members.get(to);
    if (!target || !canSignal(ctx.member.role, target.role)) return;
    const checked = validateSignal(msg.data);
    if (!checked.ok) return;
    io.to(to).emit('live:signal', { from: socket.id, data: checked.data });
  }

  /** A viewer whose connection failed asks the instructor to send a fresh offer. */
  function handleRequestOffer(socket) {
    const ctx = context(socket);
    if (!ctx || ctx.member.role !== 'viewer' || !ctx.st.hostSocketId) return;
    if (!bucketFor(socket, 'control').take()) return;
    io.to(ctx.st.hostSocketId).emit('live:viewer-joined', {
      socketId: socket.id,
      user: { id: ctx.member.userId, name: ctx.member.name },
    });
  }

  function handleChat(socket, msg) {
    const ctx = context(socket);
    if (!ctx) return { ok: false, error: 'You are not in this session.' };
    if (!bucketFor(socket, 'chat').take()) return { ok: false, error: 'You are sending messages too fast.' };
    if (!ctx.st.chatEnabled && ctx.member.role !== 'host') return { ok: false, error: 'Chat is turned off for this session.' };
    const text = cleanChatText(msg?.text);
    if (!text) return { ok: false, error: 'Write a message of up to 500 characters.' };

    const entry = {
      id: crypto.randomUUID(),
      userId: ctx.member.userId,
      name: ctx.member.name,
      role: ctx.member.role,
      text,
      at: Date.now(),
    };
    ctx.st.chat.push(entry);
    if (ctx.st.chat.length > 100) ctx.st.chat.shift();
    io.to(room(ctx.st.id)).emit('live:chat', entry);
    return { ok: true };
  }

  function handleHand(socket, msg) {
    const ctx = context(socket);
    if (!ctx || ctx.member.role !== 'viewer') return { ok: false };
    if (!bucketFor(socket, 'hand').take()) return { ok: false, error: 'Slow down.' };
    const raised = !!msg?.raised;
    if (raised) ctx.st.hands.add(ctx.member.userId);
    else ctx.st.hands.delete(ctx.member.userId);
    if (ctx.st.hostSocketId) {
      io.to(ctx.st.hostSocketId).emit('live:hand', { userId: ctx.member.userId, name: ctx.member.name, raised });
    }
    return { ok: true };
  }

  /** Instructor-only actions. Anyone else is refused, however the request was crafted. */
  function hostContext(socket) {
    const ctx = context(socket);
    if (!ctx || ctx.member.role !== 'host') return null;
    return bucketFor(socket, 'control').take() ? ctx : null;
  }

  async function handleChatToggle(socket, msg) {
    const ctx = hostContext(socket);
    if (!ctx) return { ok: false, error: 'Only the instructor can do that.' };
    ctx.st.chatEnabled = !!msg?.enabled;
    await store.setChatEnabled(ctx.st.id, ctx.st.chatEnabled);
    io.to(room(ctx.st.id)).emit('live:chat-status', { enabled: ctx.st.chatEnabled });
    return { ok: true };
  }

  async function handleKick(socket, msg) {
    const ctx = hostContext(socket);
    if (!ctx) return { ok: false, error: 'Only the instructor can do that.' };
    const userId = String(msg?.userId ?? '');
    if (!isObjectId(userId) || userId === ctx.st.hostId) return { ok: false, error: 'Choose a learner to remove.' };

    ctx.st.removed.add(userId);
    await store.addRemoved(ctx.st.id, userId);
    const viewer = ctx.st.viewers.get(userId);
    if (viewer) {
      const target = io.sockets.sockets.get(viewer.socketId);
      if (target) {
        target.emit('live:kicked');
        detach(target);
      } else {
        purgeMember(ctx.st, viewer.socketId);
      }
    }
    return { ok: true };
  }

  function handleLowerHand(socket, msg) {
    const ctx = hostContext(socket);
    if (!ctx) return { ok: false };
    const userId = String(msg?.userId ?? '');
    const viewer = ctx.st.viewers.get(userId);
    ctx.st.hands.delete(userId);
    io.to(socket.id).emit('live:hand', { userId, name: viewer?.name, raised: false });
    if (viewer) io.to(viewer.socketId).emit('live:hand-lowered');
    return { ok: true };
  }

  function register(socket) {
    socket.data.buckets = {};
    const on = (event, fn) =>
      socket.on(event, async (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = undefined;
        }
        try {
          const result = await fn(payload);
          if (typeof ack === 'function') ack(result ?? { ok: true });
        } catch (err) {
          logError(err);
          if (typeof ack === 'function') ack({ ok: false, error: 'Something went wrong. Please try again.' });
        }
      });

    on('live:join', (p) => handleJoin(socket, p));
    on('live:signal', (p) => handleSignal(socket, p));
    on('live:request-offer', () => handleRequestOffer(socket));
    on('live:chat', (p) => handleChat(socket, p));
    on('live:hand', (p) => handleHand(socket, p));
    on('live:chat-toggle', (p) => handleChatToggle(socket, p));
    on('live:kick', (p) => handleKick(socket, p));
    on('live:lower-hand', (p) => handleLowerHand(socket, p));
    on('live:leave', () => detach(socket));
    socket.on('disconnect', () => detach(socket));
  }

  return { register, ensureState, endSession, announceStarted, recover, shutdown, states };
}

module.exports = { createLiveHub, room, userRoom };

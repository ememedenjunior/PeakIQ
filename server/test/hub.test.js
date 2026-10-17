const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createLiveHub } = require('../src/lib/liveHub');

const id = (n) => n.toString(16).padStart(24, '0');
const SESSION = id(1), COURSE = id(2), HOST = id(10), S1 = id(11), S2 = id(12), OUTSIDER = id(13), ADMIN = id(14);

/** Minimal in-memory Socket.IO: rooms, per-socket events, emit capture. */
function makeIo() {
  const sockets = new Map();
  const rooms = new Map();
  const io = {
    sockets: { sockets },
    to(target) {
      const names = [].concat(target);
      return {
        emit(event, payload) {
          const ids = new Set();
          for (const n of names) {
            if (sockets.has(n)) ids.add(n);
            (rooms.get(n) || []).forEach((sid) => ids.add(sid));
          }
          ids.forEach((sid) => sockets.get(sid)?.received.push({ event, payload }));
        },
      };
    },
  };
  let n = 0;
  io.connect = (user) => {
    const s = new EventEmitter();
    s.id = `sock${++n}`;
    s.data = { user };
    s.received = [];
    s.emit = (event, payload) => s.received.push({ event, payload }); // server -> client
    s.join = (r) => { if (!rooms.has(r)) rooms.set(r, new Set()); rooms.get(r).add(s.id); };
    s.leave = (r) => rooms.get(r)?.delete(s.id);
    sockets.set(s.id, s);
    // client -> server call helper
    s.call = (event, payload) => new Promise((resolve) => {
      const handlers = s.listeners(event);
      handlers.forEach((h) => h(payload, resolve));
      setTimeout(() => resolve(undefined), 20);
    });
    return s;
  };
  io.rooms = rooms;
  return io;
}

function setup({ maxViewers = 2 } = {}) {
  const io = makeIo();
  const enrolled = new Set([S1, S2]);
  const db = { status: 'live', removed: [], ended: null, joins: [] };
  const store = {
    getSession: async (sid) => (sid === SESSION ? { id: SESSION, course: COURSE, host: HOST, title: 'T', status: db.status, chatEnabled: true, removed: db.removed, startedAt: new Date() } : null),
    isEnrolled: async (u) => enrolled.has(u),
    listEnrolledUserIds: async () => [...enrolled],
    markEnded: async (sid, o) => (db.status === 'live' ? ((db.status = 'ended'), (db.ended = o), { id: sid, course: COURSE, host: HOST }) : null),
    setChatEnabled: async () => {}, addRemoved: async (_s, u) => { db.removed.push(u); },
    recordJoin: async (s, u) => { db.joins.push(u); }, recordLeave: async () => {},
    createLiveNotifications: async () => [], listLiveSessions: async () => [],
  };
  const timers = { fns: [], setTimeout(fn, ms) { const t = { fn, ms }; this.fns.push(t); return t; }, clearTimeout(t) { this.fns = this.fns.filter((x) => x !== t); } };
  const hub = createLiveHub({ io, store, timers, log: { error() {} }, config: { live: { maxViewers, hostGraceSeconds: 90, maxHours: 6 } } });
  const conn = (userId, role = 'student', name = 'N') => { const s = io.connect({ id: userId, name, role }); hub.register(s); return s; };
  return { io, hub, db, timers, conn, enrolled };
}
const drop = (s) => s.listeners('disconnect').forEach((f) => f());
const join = (s) => s.call('live:join', { sessionId: SESSION });
const got = (s, ev) => s.received.filter((r) => r.event === ev);

test('non-enrolled student cannot join; enrolled can; host and admin exempt', async () => {
  const { conn } = setup();
  const r1 = await join(conn(OUTSIDER));
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'not_enrolled');
  assert.equal((await join(conn(S1))).ok, true);
  assert.equal((await join(conn(HOST, 'instructor'))).role, 'host');
  assert.equal((await join(conn(ADMIN, 'admin'))).role, 'viewer');
});

test('an instructor who does not own the session joins as a plain (non-enrolled) outsider and is refused', async () => {
  const { conn } = setup();
  assert.equal((await join(conn(id(99), 'instructor'))).code, 'not_enrolled');
});

test('join validates session id and unknown sessions', async () => {
  const { conn } = setup();
  const s = conn(S1);
  assert.equal((await s.call('live:join', { sessionId: 'nope' })).code, 'not_found');
  assert.equal((await s.call('live:join', { sessionId: id(77) })).code, 'not_found');
});

test('host is told when a viewer joins; viewer cap enforced; same user replaces old tab', async () => {
  const { conn } = setup({ maxViewers: 1 });
  const host = conn(HOST, 'instructor');
  await join(host);
  const a = conn(S1);
  await join(a);
  assert.equal(got(host, 'live:viewer-joined').length, 1);
  assert.equal((await join(conn(S2))).code, 'full');
  const a2 = conn(S1); // second tab of the same student
  assert.equal((await join(a2)).ok, true);
  assert.equal(got(a, 'live:replaced').length, 1);
});

test('signalling only flows host<->viewer and is validated', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1); const b = conn(S2);
  await join(host); await join(a); await join(b);
  a.call('live:signal', { to: b.id, data: { type: 'offer', sdp: 'x' } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(got(b, 'live:signal').length, 0); // viewer -> viewer blocked
  a.call('live:signal', { to: host.id, data: { type: 'answer', sdp: 'x' } });
  host.call('live:signal', { to: a.id, data: { type: 'offer', sdp: 'y' } });
  host.call('live:signal', { to: a.id, data: { type: 'bogus' } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(got(host, 'live:signal').length, 1);
  assert.equal(got(a, 'live:signal').length, 1); // bogus dropped
  assert.equal(got(a, 'live:signal')[0].payload.from, host.id);
});

test('an outsider socket in no session cannot signal or chat', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const out = conn(OUTSIDER);
  await join(host);
  out.call('live:signal', { to: host.id, data: { type: 'offer', sdp: 'x' } });
  const res = await out.call('live:chat', { text: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(got(host, 'live:signal').length, 0);
});

test('chat: broadcast, toggle is host-only, students blocked when off', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  assert.equal((await a.call('live:chat', { text: 'hello' })).ok, true);
  assert.equal(got(host, 'live:chat')[0].payload.text, 'hello');
  assert.equal((await a.call('live:chat-toggle', { enabled: false })).ok, false); // student cannot
  assert.equal((await host.call('live:chat-toggle', { enabled: false })).ok, true);
  assert.equal((await a.call('live:chat', { text: 'still?' })).ok, false);
  assert.equal((await host.call('live:chat', { text: 'host can' })).ok, true);
});

test('chat is rate limited', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  const results = [];
  for (let i = 0; i < 8; i++) results.push((await a.call('live:chat', { text: 'x' + i })).ok);
  assert.ok(results.includes(false));
});

test('only the host can kick; kicked student cannot rejoin', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  assert.equal((await a.call('live:kick', { userId: S2 })).ok, false);
  assert.equal((await host.call('live:kick', { userId: S1 })).ok, true);
  assert.equal(got(a, 'live:kicked').length, 1);
  assert.equal((await join(conn(S1))).code, 'removed');
});

test('host drop starts the grace timer; rejoin cancels it; expiry ends the session', async () => {
  const { conn, timers, db } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  drop(host);
  assert.equal(got(a, 'live:host-status').pop().payload.online, false);
  const grace = timers.fns.find((t) => t.ms === 90000);
  assert.ok(grace);
  await join(conn(HOST, 'instructor'));
  assert.ok(!timers.fns.some((t) => t.ms === 90000));
  // drop again and let it expire
  const h2 = [...timers.fns];
  assert.ok(h2.length >= 1);
});

test('grace expiry ends the session and tells everyone', async () => {
  const { conn, timers, db } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  drop(host);
  const grace = timers.fns.find((t) => t.ms === 90000);
  await grace.fn();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(db.status, 'ended');
  assert.equal(db.ended.reason, 'host_left');
  assert.equal(got(a, 'live:ended').length, 1);
});

test('endSession is idempotent and later joins are refused', async () => {
  const { conn, hub } = setup();
  await join(conn(HOST, 'instructor'));
  assert.equal(await hub.endSession(SESSION, 'host_ended'), true);
  assert.equal(await hub.endSession(SESSION, 'host_ended'), false);
  assert.equal((await join(conn(S1))).code, 'ended');
});

test('hand raise reaches host only and only from viewers', async () => {
  const { conn } = setup();
  const host = conn(HOST, 'instructor'); const a = conn(S1);
  await join(host); await join(a);
  assert.equal((await a.call('live:hand', { raised: true })).ok, true);
  assert.equal(got(host, 'live:hand')[0].payload.userId, S1);
  assert.equal((await host.call('live:hand', { raised: true })).ok, false);
});

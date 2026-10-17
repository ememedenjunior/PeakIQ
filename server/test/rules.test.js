const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { validateSignal, cleanChatText, createBucket, canJoin, canSignal } = require('../src/lib/liveRules');
const { buildIceServers } = require('../src/lib/ice');
const { strip } = require('../src/middleware/sanitize');
const cur = require('../src/lib/curriculum');

test('signal: accepts offer/answer, drops extra fields', () => {
  const r = validateSignal({ type: 'offer', sdp: 'v=0...', evil: 'x' });
  assert.deepEqual(r, { ok: true, data: { type: 'offer', sdp: 'v=0...' } });
});
test('signal: rejects bad type, huge sdp, non-objects', () => {
  assert.equal(validateSignal({ type: 'script' }).ok, false);
  assert.equal(validateSignal({ type: 'offer', sdp: 'x'.repeat(30000) }).ok, false);
  assert.equal(validateSignal('hi').ok, false);
  assert.equal(validateSignal(null).ok, false);
});
test('signal: candidates are rebuilt from known fields only', () => {
  const r = validateSignal({ type: 'candidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, x: 1 } });
  assert.deepEqual(r.data.candidate, { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });
  assert.equal(validateSignal({ type: 'candidate', candidate: null }).ok, true);
});
test('chat text is trimmed, stripped of control chars, length-limited', () => {
  assert.equal(cleanChatText('  hi\u0000 there '), 'hi there');
  assert.equal(cleanChatText('   '), null);
  assert.equal(cleanChatText('a'.repeat(501)), null);
  assert.equal(cleanChatText({}), null);
});
test('bucket refills over time', () => {
  let t = 0;
  const b = createBucket({ capacity: 2, refillPerSec: 1, now: () => t });
  assert.ok(b.take() && b.take());
  assert.equal(b.take(), false);
  t = 1000;
  assert.equal(b.take(), true);
});
test('canJoin: enrolment is required; host/admin exempt; removed and full refused', () => {
  const base = { sessionStatus: 'live', isHost: false, isAdmin: false, isEnrolled: true, removed: false, viewerCount: 0, maxViewers: 2 };
  assert.equal(canJoin(base).ok, true);
  assert.equal(canJoin({ ...base, isEnrolled: false }).code, 'not_enrolled');
  assert.equal(canJoin({ ...base, isEnrolled: false, isHost: true }).ok, true);
  assert.equal(canJoin({ ...base, isEnrolled: false, isAdmin: true }).ok, true);
  assert.equal(canJoin({ ...base, removed: true }).code, 'removed');
  assert.equal(canJoin({ ...base, viewerCount: 2 }).code, 'full');
  assert.equal(canJoin({ ...base, sessionStatus: 'ended' }).code, 'ended');
});
test('canSignal: star topology only', () => {
  assert.ok(canSignal('host', 'viewer') && canSignal('viewer', 'host'));
  assert.equal(canSignal('viewer', 'viewer'), false);
  assert.equal(canSignal('host', 'host'), false);
});

test('ice: coturn REST credentials are an HMAC of the username', () => {
  const cfg = { json: '', stunUrls: ['stun:s'], turnUrls: ['turn:t'], turnSecret: 'sek', turnTtlSeconds: 100 };
  const [stun, turn] = buildIceServers('u1', { now: 1_000_000, cfg });
  assert.deepEqual(stun.urls, ['stun:s']);
  assert.equal(turn.username, '1100:u1');
  assert.equal(turn.credential, crypto.createHmac('sha1', 'sek').update('1100:u1').digest('base64'));
});
test('ice: no TURN configured gives STUN only; JSON override wins', () => {
  assert.equal(buildIceServers('u', { cfg: { json: '', stunUrls: ['stun:s'], turnUrls: [] } }).length, 1);
  assert.deepEqual(buildIceServers('u', { cfg: { json: '[{"urls":"x"}]', stunUrls: [], turnUrls: [] } }), [{ urls: 'x' }]);
});

test('sanitize strips $operators, dotted keys and __proto__', () => {
  const body = JSON.parse('{"email":{"$gt":""},"a":{"b.c":1,"ok":2},"__proto__":{"x":1}}');
  strip(body);
  assert.deepEqual(body, { email: {}, a: { ok: 2 } });
});

/* ---- curriculum ---- */
const quizOk = { passMark: 70, questions: [{ type: 'single', prompt: 'Q?', options: ['a', 'b'], correct: [0], explanation: '' }] };

test('sanitizeCurriculum keeps own ids, replaces foreign ones, cleans video urls', () => {
  const own = cur.newId();
  const course = { modules: [{ _id: own, lessons: [] }] };
  const { modules } = cur.sanitizeCurriculum(
    [{ _id: own, title: 'M', lessons: [{ _id: 'ffffffffffffffffffffffff', title: 'L', videoUrl: 'javascript:alert(1)', quiz: quizOk }] }],
    course
  );
  assert.equal(modules[0]._id, own);
  assert.notEqual(modules[0].lessons[0]._id, 'ffffffffffffffffffffffff');
  assert.equal(modules[0].lessons[0].videoUrl, '');
  assert.equal(cur.cleanVideoUrl('https://x.test/a.mp4'), 'https://x.test/a.mp4');
  assert.equal(cur.cleanVideoUrl('http://x.test/a.mp4'), '');
});
test('sanitizeQuestion clamps correct answers to valid option indexes', () => {
  const q = cur.sanitizeQuiz({ questions: [{ type: 'single', prompt: 'p', options: ['a', 'b'], correct: [5, 1, 0] }] }).questions[0];
  assert.deepEqual(q.correct, [0]);
});
test('validateForPublish: complete course passes; gaps are reported', () => {
  const lesson = { _id: 'l1', title: 'L1', content: 'text' };
  const good = { title: 'T', summary: 's', price: 0, modules: [{ title: 'M', lessons: [lesson] }] };
  assert.deepEqual(cur.validateForPublish(good, new Map([['l1', quizOk]])), []);
  assert.match(cur.validateForPublish(good, new Map()).join(), /needs a test/);
  assert.deepEqual(cur.validateForPublish(good, new Map(), { requireQuiz: false }), []);
  assert.match(cur.validateForPublish({ ...good, modules: [] }).join(), /at least one module/);
  const badQ = { questions: [{ prompt: '', options: ['a', ''], correct: [] }] };
  assert.ok(cur.validateForPublish(good, new Map([['l1', badQ]])).length >= 3);
  assert.match(cur.validateForPublish({ ...good, price: 1.5 }, new Map([['l1', quizOk]])).join(), /price/);
});

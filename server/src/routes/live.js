const express = require('express');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { LiveSession, LiveAttendance } = require('../models/LiveSession');
const liveStore = require('../lib/liveStore');
const config = require('../config');
const { buildIceServers } = require('../lib/ice');
const { getHub } = require('../lib/socket');
const { fail } = require('../lib/errors');
const { isObjectId, cleanString } = require('../lib/validate');
const { protect, instructorOnly } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

const router = express.Router();
router.use(protect);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store'); // responses carry per-user TURN credentials
  next();
});

const uid = (req) => String(req.user._id);
const isAdmin = (req) => req.user.role === 'admin';
const idOf = (v) => String(v && v._id ? v._id : v);

/** The shape the client uses. `course` and `host` may be populated or plain ids. */
const view = (s, req) => ({
  id: String(s._id),
  title: s.title,
  status: s.status,
  startedAt: s.startedAt,
  endedAt: s.endedAt || null,
  chatEnabled: s.chatEnabled,
  peakViewers: s.peakViewers || 0,
  course: s.course && s.course.title ? { _id: String(s.course._id), title: s.course.title, slug: s.course.slug } : { _id: idOf(s.course) },
  host: s.host && s.host.name ? { id: String(s.host._id), name: s.host.name } : { id: idOf(s.host) },
  isHost: idOf(s.host) === uid(req),
});

async function ownedCourse(req, courseId) {
  if (!isObjectId(courseId)) throw fail(404, 'Course not found');
  const course = await Course.findById(courseId);
  if (!course || (!isAdmin(req) && String(course.instructor) !== uid(req))) throw fail(404, 'Course not found');
  return course;
}

/* ---------- discovery ---------- */

// Live sessions in courses I am enrolled in (or teach). Powers the "Live now" banners.
router.get('/active', async (req, res) => {
  let filter = { status: 'live' };
  if (!isAdmin(req)) {
    const enrolled = await Enrollment.find({ user: req.user._id }).distinct('course');
    const taught = req.user.role === 'instructor' ? await Course.find({ instructor: req.user._id }).distinct('_id') : [];
    filter = { status: 'live', course: { $in: [...enrolled, ...taught] } };
  }
  const sessions = await LiveSession.find(filter)
    .sort('-startedAt')
    .limit(20)
    .populate('course', 'title slug')
    .populate('host', 'name')
    .lean();
  res.json(sessions.map((s) => view(s, req)));
});

/* ---------- instructor: start and review ---------- */

router.post('/courses/:courseId/start', instructorOnly, limits.live, async (req, res) => {
  const course = await ownedCourse(req, req.params.courseId);
  const title = cleanString(req.body.title, 120) || `${course.title} live class`;

  let doc;
  try {
    doc = await LiveSession.create({
      course: course._id,
      host: req.user._id,
      title,
      status: 'live',
      chatEnabled: req.body.chatEnabled !== false,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    // The unique index allows one live session per course. Hand back the running one so the instructor can rejoin it.
    const running = await LiveSession.findOne({ course: course._id, status: 'live' }).select('_id').lean();
    throw fail(409, 'A live session is already running for this course.', { sessionId: running ? String(running._id) : undefined });
  }

  const hub = getHub();
  const session = await liveStore.getSession(doc._id);
  hub.ensureState(session);
  // Notify enrolled students in the background: a slow notification fan-out must not delay the instructor going live.
  hub.announceStarted(session, course.title).catch((err) => console.error('[live] announce failed', err));

  res.status(201).json(view(doc.toObject(), req));
});

router.get('/courses/:courseId/sessions', instructorOnly, async (req, res) => {
  const course = await ownedCourse(req, req.params.courseId);
  const sessions = await LiveSession.find({ course: course._id }).sort('-startedAt').limit(30).lean();
  const counts = await LiveAttendance.aggregate([
    { $match: { session: { $in: sessions.map((s) => s._id) } } },
    { $group: { _id: '$session', attendees: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.attendees]));
  res.json(sessions.map((s) => ({ ...view(s, req), attendees: byId.get(String(s._id)) || 0 })));
});

/* ---------- a single session ---------- */

// Enrolment gate for the page. The socket join checks again, independently, so neither path can be skipped.
router.get('/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) throw fail(404, 'Live session not found.');
  const session = await LiveSession.findById(req.params.id).populate('course', 'title slug').populate('host', 'name').lean();
  if (!session) throw fail(404, 'Live session not found.');

  const isHost = idOf(session.host) === uid(req);
  const allowed = isHost || isAdmin(req) || !!(await Enrollment.exists({ user: req.user._id, course: idOf(session.course) }));
  if (!allowed) throw fail(403, 'Only students enrolled in this course can join its live sessions.');
  if (!isHost && (session.removed || []).some((r) => String(r) === uid(req))) {
    throw fail(403, 'The instructor removed you from this session.');
  }

  res.json({
    session: view(session, req),
    iceServers: session.status === 'live' ? buildIceServers(uid(req)) : [],
    maxViewers: config.live.maxViewers,
  });
});

router.post('/:id/end', async (req, res) => {
  if (!isObjectId(req.params.id)) throw fail(404, 'Live session not found.');
  const session = await LiveSession.findById(req.params.id).select('host status').lean();
  if (!session) throw fail(404, 'Live session not found.');
  if (idOf(session.host) !== uid(req) && !isAdmin(req)) throw fail(403, 'Only the instructor who started this session can end it.');

  const ended = await getHub().endSession(String(session._id), 'host_ended');
  res.json({ ok: true, ended });
});

router.get('/:id/attendance', async (req, res) => {
  if (!isObjectId(req.params.id)) throw fail(404, 'Live session not found.');
  const session = await LiveSession.findById(req.params.id).select('host').lean();
  if (!session) throw fail(404, 'Live session not found.');
  if (idOf(session.host) !== uid(req) && !isAdmin(req)) throw fail(403, 'Only the instructor can see attendance.');

  const rows = await LiveAttendance.find({ session: session._id }).populate('user', 'name email').sort('firstJoinedAt').limit(500).lean();
  res.json(
    rows.map((r) => ({
      user: r.user ? { id: String(r.user._id), name: r.user.name, email: r.user.email } : null,
      firstJoinedAt: r.firstJoinedAt,
      lastLeftAt: r.lastLeftAt || null,
      joins: r.joins,
      totalSeconds: r.totalSeconds,
    }))
  );
});

module.exports = router;

const express = require('express');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { LessonQuiz } = require('../models/Assessment');
const { countLessons } = require('../lib/curriculum');
const { fail } = require('../lib/errors');
const { isObjectId, cleanString } = require('../lib/validate');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const isStaffOf = (user, course) =>
  !!user && (user.role === 'admin' || String(course.instructor) === String(user._id));

// Outline for the public page: titles for everyone, bodies only for free-preview lessons.
function toOutline(course) {
  return {
    _id: course._id,
    title: course.title,
    slug: course.slug,
    track: course.track,
    level: course.level,
    summary: course.summary,
    outcomes: course.outcomes,
    price: course.price,
    version: course.version,
    lessonCount: countLessons(course),
    modules: course.modules.map((m) => ({
      _id: m._id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        _id: l._id,
        title: l.title,
        durationMins: l.durationMins,
        isPreview: l.isPreview,
        ...(l.isPreview ? { content: l.content, videoUrl: l.videoUrl } : {}),
      })),
    })),
  };
}

// Public catalog. Uses an aggregation so lesson bodies are never loaded just to count lessons.
router.get('/', async (req, res) => {
  const match = { status: 'published' };
  const track = cleanString(req.query.track, 60);
  if (track) match.track = track;

  const courses = await Course.aggregate([
    { $match: match },
    { $sort: { createdAt: 1 } },
    { $limit: 200 },
    {
      $project: {
        title: 1,
        slug: 1,
        track: 1,
        level: 1,
        summary: 1,
        price: 1,
        version: 1,
        lessonCount: { $sum: { $map: { input: '$modules', as: 'm', in: { $size: { $ifNull: ['$$m.lessons', []] } } } } },
      },
    },
  ]);

  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.json(courses);
});

// Course outline (public). Includes `enrolled` when a valid token is sent.
router.get('/:slug', optionalAuth, async (req, res) => {
  const slug = cleanString(req.params.slug, 120).toLowerCase();
  const course = await Course.findOne({ slug, status: 'published' }).lean();
  if (!course) throw fail(404, 'Course not found');

  const enrolled = req.user
    ? !!(await Enrollment.exists({ user: req.user._id, course: course._id })) || isStaffOf(req.user, course)
    : false;

  res.set('Cache-Control', 'private, no-cache'); // the response depends on who is asking
  res.json({ ...toOutline(course), enrolled });
});

/** Loads a course the caller may study: an enrolled learner (published courses only) or its own instructor/admin. */
async function studyAccess(req) {
  if (!isObjectId(req.params.id)) throw fail(404, 'Course not found');
  const course = await Course.findById(req.params.id).lean();
  if (!course) throw fail(404, 'Course not found');

  const staff = isStaffOf(req.user, course);
  const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id }).lean();
  if (!staff) {
    if (course.status !== 'published') throw fail(404, 'Course not found');
    if (!enrollment) throw fail(403, 'Enrol in this course to access the lessons.');
  }
  return { course, enrollment, staff };
}

// Which lessons end with a test (the answer keys themselves never leave the server).
const quizLessonIds = async (courseId) => (await LessonQuiz.find({ course: courseId }).distinct('lessonId')).map(String);

// Full content: enrolled learners, plus the course's own instructor or an admin for previewing.
router.get('/:id/content', protect, async (req, res) => {
  const { course, enrollment } = await studyAccess(req);
  res.set('Cache-Control', 'no-store');
  res.json({ course, enrollment, quizLessonIds: await quizLessonIds(course._id) });
});

// Offline package: complete course + version, to be stored in IndexedDB.
// Only people who actually own the course can download it.
router.get('/:id/offline', protect, async (req, res) => {
  const { course, enrollment } = await studyAccess(req);
  if (!enrollment) throw fail(403, 'Enrol in this course to download it.');
  res.set('Cache-Control', 'no-store');
  res.json({
    userId: req.user._id,
    downloadedAt: new Date().toISOString(),
    version: course.version,
    course,
    quizLessonIds: await quizLessonIds(course._id),
  });
});

module.exports = router;

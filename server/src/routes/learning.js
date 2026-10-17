const express = require('express');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { LessonQuiz, QuizAttempt, Submission } = require('../models/Assessment');
const notify = require('../lib/notify');
const { fail } = require('../lib/errors');
const { isObjectId } = require('../lib/validate');
const { protect } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

const router = express.Router();
router.use(protect);

const uid = (req) => String(req.user._id);

/** Finds the lesson and checks the caller is allowed to use it. */
async function lessonFor(req) {
  const { courseId, lessonId } = req.params;
  if (!isObjectId(courseId) || !isObjectId(lessonId)) throw fail(404, 'Lesson not found');

  const course = await Course.findById(courseId).lean();
  const lesson = course?.modules.flatMap((m) => m.lessons).find((l) => String(l._id) === lessonId);
  if (!lesson) throw fail(404, 'Lesson not found');

  const staff = req.user.role === 'admin' || String(course.instructor) === uid(req);
  if (!staff) {
    if (course.status !== 'published') throw fail(404, 'Lesson not found');
    const allowed = lesson.isPreview || (await Enrollment.exists({ user: uid(req), course: course._id }));
    if (!allowed) throw fail(403, 'Enrol in this course to continue.');
  }
  return { course, lesson };
}

const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const asPick = (v) =>
  [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);

/* ---------- lesson test ---------- */

// The test WITHOUT the answer key
router.get('/courses/:courseId/lessons/:lessonId/quiz', async (req, res) => {
  const { course, lesson } = await lessonFor(req);
  const quiz = await LessonQuiz.findOne({ course: course._id, lessonId: lesson._id }).lean();
  if (!quiz) return res.json(null);

  const best = await QuizAttempt.findOne({ user: uid(req), course: course._id, lessonId: lesson._id }).sort('-score').lean();

  res.json({
    passMark: quiz.passMark,
    questions: quiz.questions.map(({ type, prompt, options }) => ({ type, prompt, options })),
    best: best ? { score: best.score, passed: best.passed } : null,
  });
});

// Grades on the server. Body: { answers: [[0], [1, 3], ...] } (one array of option indexes per question)
router.post('/courses/:courseId/lessons/:lessonId/quiz/attempt', limits.quiz, async (req, res) => {
  const { course, lesson } = await lessonFor(req);
  const quiz = await LessonQuiz.findOne({ course: course._id, lessonId: lesson._id }).lean();
  if (!quiz) throw fail(404, 'This lesson has no test.');

  const given = Array.isArray(req.body.answers) ? req.body.answers : [];
  const picks = quiz.questions.map((_, i) => asPick(given[i]));
  const results = quiz.questions.map((q, i) => ({
    correct: sameSet(picks[i], [...q.correct].sort((a, b) => a - b)),
    explanation: q.explanation,
  }));

  const right = results.filter((r) => r.correct).length;
  const total = quiz.questions.length;
  const score = total ? Math.round((right / total) * 100) : 0;
  const passed = score >= quiz.passMark;

  await QuizAttempt.create({ user: uid(req), course: course._id, lessonId: lesson._id, score, passed, answers: picks });
  res.json({ score, passed, passMark: quiz.passMark, right, total, results });
});

/* ---------- practical task ---------- */

router.get('/courses/:courseId/lessons/:lessonId/task', async (req, res) => {
  const { course, lesson } = await lessonFor(req);
  if (!lesson.task) return res.json(null);
  const submission = await Submission.findOne({ user: uid(req), course: course._id, lessonId: lesson._id })
    .select('answer status grade feedback attempts updatedAt')
    .lean();
  res.json({ task: lesson.task, submission });
});

router.post('/courses/:courseId/lessons/:lessonId/task/submission', limits.writes, async (req, res) => {
  const { course, lesson } = await lessonFor(req);
  if (!lesson.task) throw fail(404, 'This lesson has no practical task.');

  const answer = typeof req.body.answer === 'string' ? req.body.answer.trim().slice(0, 20000) : '';
  if (!answer) throw fail(400, 'Add your answer before submitting.');

  if (lesson.task.submissionType === 'link') {
    let url;
    try {
      url = new URL(answer);
    } catch {
      throw fail(400, 'Paste a full link, starting with https://');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw fail(400, 'Paste a full link, starting with https://');
  }

  const submission = await Submission.findOneAndUpdate(
    { user: uid(req), course: course._id, lessonId: lesson._id },
    {
      $set: { answer, status: 'submitted', grade: null, feedback: '' },
      $unset: { reviewedBy: 1, reviewedAt: 1 },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select('status attempts updatedAt');

  res.status(201).json(submission);
});

/* ---------- dashboard and progress ---------- */

// My courses with progress. Only ids and titles are loaded, never lesson bodies.
router.get('/dashboard', async (req, res) => {
  const enrollments = await Enrollment.find({ user: req.user._id })
    .populate({ path: 'course', select: 'title slug track level status modules.lessons._id' })
    .sort({ updatedAt: -1 })
    .lean();

  const items = enrollments
    .filter((e) => e.course && e.course.status === 'published')
    .map((e) => {
      const total = e.course.modules.reduce((n, m) => n + m.lessons.length, 0);
      const done = e.completedLessons.length;
      return {
        enrollmentId: e._id,
        course: { _id: e.course._id, title: e.course.title, slug: e.course.slug, track: e.course.track, level: e.course.level },
        totalLessons: total,
        completedLessons: done,
        percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
        lastLesson: e.lastLesson,
      };
    });

  res.json({
    stats: {
      enrolled: items.length,
      completed: items.filter((i) => i.percent === 100).length,
      lessonsDone: items.reduce((n, i) => n + i.completedLessons, 0),
    },
    courses: items,
  });
});

// Mark a lesson complete. The lesson's own rules apply: pass its test, submit its required task.
router.post('/progress', async (req, res) => {
  const { courseId, lessonId } = req.body;
  if (!isObjectId(courseId) || !isObjectId(lessonId)) throw fail(400, 'Invalid ids');

  const course = await Course.findById(courseId).lean();
  const enrollment = course && (await Enrollment.findOne({ user: req.user._id, course: courseId }));
  if (!course || course.status !== 'published' || !enrollment) throw fail(403, 'Not enrolled');

  const lessons = course.modules.flatMap((m) => m.lessons);
  const lesson = lessons.find((l) => String(l._id) === lessonId);
  if (!lesson) throw fail(400, 'Lesson not in course');

  const quiz = await LessonQuiz.findOne({ course: courseId, lessonId }).select('passMark').lean();
  if (quiz && !(await QuizAttempt.exists({ user: req.user._id, course: courseId, lessonId, passed: true }))) {
    throw fail(409, `Pass this lesson's test (${quiz.passMark}% or more) to continue.`);
  }
  if (lesson.task?.required && !(await Submission.exists({ user: req.user._id, course: courseId, lessonId }))) {
    throw fail(409, 'Submit the practical task to finish this lesson.');
  }

  const before = enrollment.completedLessons.length;
  const after = await Enrollment.findOneAndUpdate(
    { _id: enrollment._id },
    { $addToSet: { completedLessons: lessonId }, $set: { lastLesson: lessonId } },
    { new: true }
  );

  const total = lessons.length;
  const done = after.completedLessons.length;
  if (done > before && done >= total) {
    await notify(req.user._id, {
      type: 'course',
      title: 'Course completed 🎉',
      message: `You finished ${course.title}. Great work!`,
      link: '/dashboard',
    });
  }
  res.json({ completedLessons: after.completedLessons, percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0 });
});

module.exports = router;

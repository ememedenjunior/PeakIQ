const express = require('express');
const crypto = require('crypto');
const Course = require('../models/Course');
const { LessonQuiz, Submission } = require('../models/Assessment');
const { LiveSession } = require('../models/LiveSession');
const notify = require('../lib/notify');
const config = require('../config');
const { protect, instructorOnly } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');
const { fail } = require('../lib/errors');
const { isObjectId } = require('../lib/validate');
const { sanitizeMeta, sanitizeCurriculum, validateForPublish, slugify, countLessons } = require('../lib/curriculum');

const router = express.Router();
router.use(protect, instructorOnly, limits.writes);

const uid = (req) => String(req.user._id);
const isAdmin = (req) => req.user.role === 'admin';

/** Loads a course the caller owns (admins can open any). Other people's courses look like they do not exist. */
async function ownedCourse(req, id = req.params.id) {
  if (!isObjectId(String(id))) throw fail(404, 'Course not found');
  const course = await Course.findById(id);
  if (!course || (!isAdmin(req) && String(course.instructor) !== uid(req))) throw fail(404, 'Course not found');
  return course;
}

async function uniqueSlug(title) {
  const root = slugify(title);
  let slug = root;
  let n = 1;
  while (await Course.exists({ slug })) slug = `${root}-${++n}`;
  return slug;
}

async function loadQuizMap(courseId) {
  const quizzes = await LessonQuiz.find({ course: courseId }).lean();
  return new Map(quizzes.map((q) => [String(q.lessonId), q]));
}

/** Course + each lesson's quiz, in the shape the builder edits. */
async function present(course) {
  const [quizMap, live] = await Promise.all([
    loadQuizMap(course._id),
    LiveSession.findOne({ course: course._id, status: 'live' }).select('_id').lean(),
  ]);
  const obj = course.toObject();
  obj.modules.forEach((m) =>
    m.lessons.forEach((l) => {
      const q = quizMap.get(String(l._id));
      l.quiz = q ? { passMark: q.passMark, questions: q.questions } : null;
    })
  );
  obj.liveSessionId = live ? String(live._id) : null;
  return obj;
}

async function syncQuizzes(courseId, quizzes) {
  const withQuiz = quizzes.filter((q) => q.quiz);
  await LessonQuiz.deleteMany({ course: courseId, lessonId: { $nin: withQuiz.map((q) => q.lessonId) } });
  if (!withQuiz.length) return;
  await LessonQuiz.bulkWrite(
    withQuiz.map(({ lessonId, quiz }) => ({
      updateOne: { filter: { course: courseId, lessonId }, update: { $set: quiz }, upsert: true },
    }))
  );
}

const publishCheck = (courseObj, quizMap) => validateForPublish(courseObj, quizMap, { requireQuiz: config.requireLessonQuiz });

/* ---------- courses ---------- */

router.get('/courses', async (req, res) => {
  const filter = isAdmin(req) ? {} : { instructor: uid(req) };
  const courses = await Course.find(filter).select('-modules.lessons.content -modules.lessons.task').sort('-updatedAt').limit(200).lean();
  const live = await LiveSession.find({ course: { $in: courses.map((c) => c._id) }, status: 'live' }).select('course').lean();
  const liveByCourse = new Map(live.map((s) => [String(s.course), String(s._id)]));

  res.json(
    courses.map((c) => ({
      _id: c._id,
      title: c.title,
      slug: c.slug,
      track: c.track,
      level: c.level,
      status: c.status,
      price: c.price,
      updatedAt: c.updatedAt,
      modules: c.modules.length,
      lessons: countLessons(c),
      liveSessionId: liveByCourse.get(String(c._id)) || null,
    }))
  );
});

router.post('/courses', async (req, res) => {
  const meta = sanitizeMeta(req.body);
  if (!meta.title) throw fail(400, 'Give your course a title.');

  // The slug never changes after creation, so links stay stable. Two people creating the same title at once
  // can race to the same slug; the unique index catches it and we retry with a random suffix.
  let course;
  for (let attempt = 0; attempt < 4 && !course; attempt++) {
    const slug = attempt === 0 ? await uniqueSlug(meta.title) : `${slugify(meta.title)}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      course = await Course.create({ ...meta, slug, instructor: uid(req), status: 'draft', modules: [] });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  if (!course) throw fail(409, 'Could not reserve a link for that title. Try a slightly different title.');
  res.status(201).json(await present(course));
});

router.get('/courses/:id', async (req, res) => res.json(await present(await ownedCourse(req))));

// Saves details and the whole curriculum (modules, lessons, tests, tasks) in one go.
router.put('/courses/:id', async (req, res) => {
  const course = await ownedCourse(req);
  const meta = sanitizeMeta(req.body);
  if ('title' in meta && !meta.title) throw fail(400, 'The course needs a title.');

  const curriculum = req.body.modules !== undefined ? sanitizeCurriculum(req.body.modules, course) : null;

  // A live course must stay complete, otherwise learners could hit half-built lessons
  if (course.status === 'published') {
    const quizMap = curriculum
      ? new Map(curriculum.quizzes.map((q) => [String(q.lessonId), q.quiz]))
      : await loadQuizMap(course._id);
    const problems = publishCheck(
      { ...course.toObject(), ...meta, modules: curriculum ? curriculum.modules : course.toObject().modules },
      quizMap
    );
    if (problems.length) throw fail(422, 'This course is live, so it has to stay complete. Fix these first:', { problems });
  }

  Object.assign(course, meta);
  if (curriculum) course.modules = curriculum.modules;
  course.version = (course.version || 1) + 1; // learners' offline copies refresh on their next visit
  await course.save();
  if (curriculum) await syncQuizzes(course._id, curriculum.quizzes);
  res.json(await present(course));
});

router.post('/courses/:id/publish', async (req, res) => {
  const course = await ownedCourse(req);
  const problems = publishCheck(course.toObject(), await loadQuizMap(course._id));
  if (problems.length) throw fail(422, 'Fix these before publishing:', { problems });
  course.status = 'published';
  course.publishedAt ||= new Date();
  await course.save();
  res.json({ status: course.status });
});

router.post('/courses/:id/unpublish', async (req, res) => {
  const course = await ownedCourse(req);
  course.status = 'draft';
  await course.save();
  res.json({ status: course.status });
});

router.delete('/courses/:id', async (req, res) => {
  const course = await ownedCourse(req);
  if (course.publishedAt) {
    throw fail(409, "This course has been published before, so it can't be deleted. Unpublish it to hide it from learners.");
  }
  await LessonQuiz.deleteMany({ course: course._id });
  await course.deleteOne();
  res.json({ ok: true });
});

/* ---------- practical task submissions ---------- */

router.get('/courses/:id/submissions', async (req, res) => {
  const course = await ownedCourse(req);
  const filter = { course: course._id };
  if (['submitted', 'reviewed'].includes(req.query.status)) filter.status = req.query.status;

  const subs = await Submission.find(filter).sort('-updatedAt').limit(200).populate('user', 'name email').lean();

  const info = new Map();
  course.modules.forEach((m) =>
    m.lessons.forEach((l) =>
      info.set(String(l._id), {
        lessonTitle: l.title,
        taskTitle: l.task?.title,
        submissionType: l.task?.submissionType,
        language: l.task?.language,
        rubric: l.task?.rubric || [],
      })
    )
  );
  res.json(subs.map((s) => ({ ...s, ...info.get(String(s.lessonId)) })));
});

router.patch('/submissions/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) throw fail(404, 'Submission not found');
  const sub = await Submission.findById(req.params.id);
  if (!sub) throw fail(404, 'Submission not found');
  const course = await ownedCourse(req, sub.course); // must own the course this belongs to

  const grade = req.body.grade === '' || req.body.grade == null ? NaN : Number(req.body.grade);
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) throw fail(400, 'Enter a grade between 0 and 100.');

  sub.grade = Math.round(grade);
  sub.feedback = typeof req.body.feedback === 'string' ? req.body.feedback.trim().slice(0, 5000) : '';
  sub.status = 'reviewed';
  sub.reviewedBy = uid(req);
  sub.reviewedAt = new Date();
  await sub.save();

  await notify(sub.user, {
    type: 'course',
    title: 'Your practical task was graded',
    message: `You scored ${sub.grade}% in ${course.title}.${sub.feedback ? ' Your instructor left feedback.' : ''}`,
    link: `/learn/${course._id}`,
  });
  res.json({ ok: true });
});

module.exports = router;

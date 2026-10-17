const crypto = require('crypto');

const LEVELS = ['beginner', 'intermediate', 'advanced'];
const TASK_TYPES = ['text', 'code', 'link'];
const LANGS = ['python', 'sql', 'javascript', 'html', 'other'];

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, len) => (Array.isArray(v) ? v : []).slice(0, max).map((x) => str(x, len)).filter(Boolean);

// 24 hex characters: a valid ObjectId that Mongoose casts automatically, without importing Mongoose here.
const newId = () => crypto.randomBytes(12).toString('hex');

const slugify = (s, fallback = 'course') =>
  str(s, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

/** Only direct https links are accepted; anything else is dropped rather than stored. */
function cleanVideoUrl(v) {
  const raw = str(v, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

const countLessons = (course) => (course.modules || []).reduce((n, m) => n + (m.lessons || []).length, 0);

/* ---------- sanitising (lenient: drafts may be incomplete, but shapes are always safe) ---------- */

function sanitizeMeta(b = {}) {
  const out = {};
  if ('title' in b) out.title = str(b.title, 160);
  if ('summary' in b) out.summary = str(b.summary, 600);
  if ('track' in b) {
    const t = slugify(b.track, '').slice(0, 60);
    if (t) out.track = t;
  }
  if (LEVELS.includes(b.level)) out.level = b.level;
  if ('outcomes' in b) out.outcomes = list(b.outcomes, 12, 200);
  if ('price' in b) out.price = Math.min(10_000_000, Math.max(0, Math.round(Number(b.price) || 0)));
  return out;
}

function sanitizeQuestion(q = {}) {
  const type = q.type === 'multiple' ? 'multiple' : 'single';
  const options = (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => str(o, 300));
  const correct = [
    ...new Set(
      (Array.isArray(q.correct) ? q.correct : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < options.length)
    ),
  ].sort((a, b) => a - b);
  return {
    type,
    prompt: str(q.prompt, 1000),
    options,
    correct: type === 'single' ? correct.slice(0, 1) : correct,
    explanation: str(q.explanation, 1000),
  };
}

function sanitizeQuiz(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) return null;
  const pm = quiz.passMark === '' || quiz.passMark == null ? NaN : Number(quiz.passMark);
  return {
    passMark: Number.isFinite(pm) ? Math.min(100, Math.max(0, Math.round(pm))) : 70,
    questions: quiz.questions.slice(0, 50).map(sanitizeQuestion),
  };
}

function sanitizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  const title = str(t.title, 160);
  const instructions = str(t.instructions, 20000);
  if (!title && !instructions) return null;
  return {
    title,
    instructions,
    submissionType: TASK_TYPES.includes(t.submissionType) ? t.submissionType : 'text',
    language: LANGS.includes(t.language) ? t.language : 'python',
    rubric: list(t.rubric, 12, 300),
    required: Boolean(t.required),
  };
}

/**
 * Rebuilds modules/lessons from client input.
 * - Existing _ids are kept ONLY if they already belong to this course (so learner
 *   progress stays attached to lessons, and ids from other courses are ignored).
 * - New items get fresh ObjectIds, so quizzes can be keyed before the course is saved.
 */
function sanitizeCurriculum(input, course) {
  const known = new Set();
  (course.modules || []).forEach((m) => {
    known.add(String(m._id));
    (m.lessons || []).forEach((l) => known.add(String(l._id)));
  });
  const used = new Set();
  const id = (raw) => {
    const v = raw && known.has(String(raw)) && !used.has(String(raw)) ? String(raw) : newId();
    used.add(v);
    return v;
  };

  const quizzes = [];
  const modules = (Array.isArray(input) ? input : []).slice(0, 50).map((m = {}) => ({
    _id: id(m._id),
    title: str(m.title, 160) || 'Untitled module',
    lessons: (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 100).map((l = {}) => {
      const lessonId = id(l._id);
      quizzes.push({ lessonId, quiz: sanitizeQuiz(l.quiz) });
      const mins = Number(l.durationMins);
      return {
        _id: lessonId,
        title: str(l.title, 160) || 'Untitled lesson',
        content: str(l.content, 100000),
        videoUrl: cleanVideoUrl(l.videoUrl),
        durationMins: Number.isFinite(mins) ? Math.min(600, Math.max(0, Math.round(mins))) : 10,
        isPreview: Boolean(l.isPreview),
        task: sanitizeTask(l.task),
      };
    }),
  }));
  return { modules, quizzes };
}

/* ---------- publish checks (strict: a live course must be complete) ---------- */

const MAX_PROBLEMS = 15;

function quizProblems(label, quiz) {
  const out = [];
  if (!quiz.questions || quiz.questions.length === 0) {
    out.push(`${label}: the test has no questions.`);
    return out;
  }
  quiz.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.prompt) out.push(`${label}: question ${n} has no text.`);
    const filled = (q.options || []).filter((o) => String(o).trim());
    if (filled.length < 2 || filled.length !== (q.options || []).length) {
      out.push(`${label}: question ${n} needs at least two options, none of them empty.`);
    }
    if (!q.correct || q.correct.length === 0) out.push(`${label}: question ${n} has no correct answer selected.`);
  });
  return out;
}

/**
 * Returns a list of human-readable problems (empty means the course is ready to be live).
 * `quizMap` maps lessonId -> quiz (or null).
 */
function validateForPublish(course, quizMap = new Map(), { requireQuiz = true } = {}) {
  const problems = [];
  if (!str(course.title, 160)) problems.push('The course needs a title.');
  if (!str(course.summary, 600)) problems.push('Add a short summary so learners know what the course is about.');
  if (!Number.isInteger(course.price) || course.price < 0) problems.push('The price must be 0 (free) or a positive whole number of naira.');

  const modules = course.modules || [];
  if (modules.length === 0 || countLessons(course) === 0) {
    problems.push('Add at least one module with at least one lesson.');
  }

  modules.forEach((m, mi) => {
    const mLabel = `Module ${mi + 1} "${m.title}"`;
    if (!m.lessons || m.lessons.length === 0) problems.push(`${mLabel} has no lessons.`);
    (m.lessons || []).forEach((l) => {
      const label = `Lesson "${l.title}"`;
      if (!str(l.content, 100000) && !l.videoUrl) problems.push(`${label} has no content yet.`);

      const quiz = quizMap.get(String(l._id));
      if (quiz) problems.push(...quizProblems(label, quiz));
      else if (requireQuiz) problems.push(`${label} needs a test.`);

      if (l.task && (!str(l.task.title, 160) || !str(l.task.instructions, 20000))) {
        problems.push(`${label}: the practical task needs a title and instructions.`);
      }
    });
  });

  if (problems.length > MAX_PROBLEMS) {
    const extra = problems.length - MAX_PROBLEMS;
    return [...problems.slice(0, MAX_PROBLEMS), `...and ${extra} more.`];
  }
  return problems;
}

module.exports = {
  slugify,
  newId,
  countLessons,
  cleanVideoUrl,
  sanitizeMeta,
  sanitizeQuiz,
  sanitizeTask,
  sanitizeCurriculum,
  validateForPublish,
};

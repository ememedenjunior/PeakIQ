import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { downloadCourse, getOfflineCourse, queueProgress, removeOfflineCourse } from '../lib/offline';
import LessonQuiz from '../components/LessonQuiz.jsx';
import LessonTask from '../components/LessonTask.jsx';
import LiveBanner from '../components/LiveBanner.jsx';

export default function Learn() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  const [done, setDone] = useState(new Set());
  const [currentId, setCurrentId] = useState(null);
  const [fromOffline, setFromOffline] = useState(false);
  const [canTrack, setCanTrack] = useState(true); // false when an instructor is previewing their own course
  const [quizIds, setQuizIds] = useState(new Set()); // lessons that end with a test
  const [gate, setGate] = useState({}); // lessonId -> { quizPassed, taskSubmitted }, filled in by the test/task panels
  const [hasCopy, setHasCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Online first (so entitlement and progress are fresh); fall back to the downloaded copy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getOfflineCourse(user.id, courseId);
      setHasCopy(!!stored);
      try {
        const { course: c, enrollment, quizLessonIds } = await api(`/courses/${courseId}/content`);
        if (cancelled) return;
        setCourse(c);
        setDone(new Set((enrollment?.completedLessons || []).map(String)));
        setQuizIds(new Set(quizLessonIds || []));
        setCanTrack(!!enrollment);
        setCurrentId(enrollment?.lastLesson || c.modules[0]?.lessons[0]?._id);
        setFromOffline(false);
        // keep an existing offline copy current with the latest course version
        if (stored && stored.version !== c.version) downloadCourse(user.id, courseId).catch(() => {});
      } catch (e) {
        if (cancelled) return;
        if (e.status === 0 && stored) {
          setCourse(stored.course);
          setQuizIds(new Set(stored.quizLessonIds || []));
          setCurrentId(stored.course.modules[0]?.lessons[0]?._id);
          setFromOffline(true);
        } else {
          setError(e.status === 0 ? 'You are offline and this course has not been downloaded.' : e.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, user.id]);

  const lessons = useMemo(() => (course ? course.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.title }))) : []), [course]);
  const index = lessons.findIndex((l) => l._id === currentId);
  const lesson = lessons[index];
  const percent = lessons.length ? Math.round((done.size / lessons.length) * 100) : 0;

  const g = (lesson && gate[lesson._id]) || {};
  const needsQuiz = !!lesson && quizIds.has(lesson._id) && !g.quizPassed && !done.has(lesson._id);
  const needsTask = !!lesson && !!lesson.task?.required && !g.taskSubmitted && !done.has(lesson._id);
  const offlineBlocked = fromOffline && !!lesson && quizIds.has(lesson._id) && !done.has(lesson._id);

  const setLessonGate = useCallback((lessonId, patch) => {
    setGate((all) => ({ ...all, [lessonId]: { ...all[lessonId], ...patch } }));
  }, []);

  const goNext = () => lessons[index + 1] && setCurrentId(lessons[index + 1]._id);

  const complete = useCallback(async () => {
    if (!lesson) return;
    if (done.has(lesson._id)) return goNext();
    setError('');
    const payload = { courseId, lessonId: lesson._id };
    try {
      // The server is the judge: it checks the lesson's test and required task before accepting.
      const r = await api('/learning/progress', { method: 'POST', body: payload });
      setDone(new Set(r.completedLessons.map(String)));
    } catch (e) {
      if (e.status === 0) {
        queueProgress(payload); // synced when back online
        setDone((d) => new Set(d).add(lesson._id));
      } else {
        setError(e.message);
        return;
      }
    }
    goNext();
  }, [lesson, lessons, index, courseId, done]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleDownload() {
    setBusy(true);
    setError('');
    try {
      if (hasCopy) {
        await removeOfflineCourse(user.id, courseId);
        setHasCopy(false);
      } else {
        await downloadCourse(user.id, courseId);
        setHasCopy(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !course) return <div className="card center"><p className="error">{error}</p><Link to="/dashboard">Back to dashboard</Link></div>;
  if (!course) return <p className="muted">Loading course…</p>;

  const blockedReason = needsQuiz
    ? 'Pass the lesson test to continue.'
    : needsTask
      ? 'Submit the practical task to continue.'
      : offlineBlocked
        ? 'Go online to take this lesson’s test.'
        : '';

  return (
    <>
      <LiveBanner courseId={courseId} />
      <div className="learn">
        <aside className="card outline">
          <h3>{course.title}</h3>
          <div className="bar"><div style={{ width: `${percent}%` }} /></div>
          <p className="muted">{percent}% complete</p>
          {!fromOffline && canTrack && (
            <button className="btn small ghost" onClick={toggleDownload} disabled={busy}>
              {busy ? 'Working…' : hasCopy ? '✓ Downloaded · Remove' : '⬇ Download for offline'}
            </button>
          )}
          {fromOffline && <p className="pill ok">Offline mode</p>}
          {!canTrack && <p className="pill">Instructor preview</p>}
          {course.modules.map((m) => (
            <div key={m._id}>
              <h4>{m.title}</h4>
              <ul>
                {m.lessons.map((l) => (
                  <li key={l._id}>
                    <button className={`lesson ${l._id === currentId ? 'current' : ''}`} onClick={() => setCurrentId(l._id)}>
                      <span aria-hidden="true">{done.has(l._id) ? '✅' : '○'}</span>
                      <span className="sr-only">{done.has(l._id) ? 'Completed: ' : ''}</span> {l.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div>
          <article className="card lesson-view">
            {lesson ? (
              <>
                <p className="muted">{lesson.module} · {lesson.durationMins} min</p>
                <h1>{lesson.title}</h1>
                {lesson.videoUrl && <video controls preload="metadata" src={lesson.videoUrl} className="video" />}
                <div className="prose"><ReactMarkdown>{lesson.content}</ReactMarkdown></div>
              </>
            ) : (
              <p className="muted">This course has no lessons yet.</p>
            )}
          </article>

          {lesson && !fromOffline && (
            <>
              <LessonQuiz key={`q-${lesson._id}`} courseId={courseId} lessonId={lesson._id}
                onStatus={(s) => setLessonGate(lesson._id, { quizPassed: s.passed })} />
              <LessonTask key={`t-${lesson._id}`} courseId={courseId} lessonId={lesson._id}
                onStatus={(s) => setLessonGate(lesson._id, { taskSubmitted: s.submitted })} />
            </>
          )}

          {lesson && (
            <div className="card lesson-nav">
              {error && <p className="error" role="alert">{error}</p>}
              {blockedReason && <p className="muted" role="status">{blockedReason}</p>}
              <div className="row nav-row">
                <button className="btn ghost" disabled={index <= 0} onClick={() => setCurrentId(lessons[index - 1]._id)}>← Previous</button>
                {canTrack ? (
                  <button className="btn" onClick={complete} disabled={!!blockedReason}>
                    {done.has(lesson._id) ? (index < lessons.length - 1 ? 'Next lesson →' : 'Finished') : 'Mark complete & continue'}
                  </button>
                ) : (
                  <button className="btn" onClick={goNext} disabled={index >= lessons.length - 1}>Next lesson →</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

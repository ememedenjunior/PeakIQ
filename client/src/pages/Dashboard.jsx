import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trackLabel } from '../components/CourseCard.jsx';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { listOfflineCourseIds } from '../lib/offline';
import LiveBanner from '../components/LiveBanner.jsx';

const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0));

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function ProgressBar({ percent, label }) {
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

function CourseTile({ item, isOffline }) {
  const { course, completedLessons, totalLessons } = item;
  const percent = clamp(item.percent);
  const done = percent === 100;
  const cta = done ? 'Review' : percent > 0 ? 'Continue' : 'Start';

  return (
    <article className="card course">
      <div className="row">
        <span className={`pill ${course.track}`}>{trackLabel(course.track)}</span>
        {done && <span className="pill ok">Completed</span>}
      </div>
      <h3>{course.title}</h3>
      <ProgressBar percent={percent} label={`${course.title} progress`} />
      <div className="row">
        <span className="muted">
          {completedLessons}/{totalLessons} lessons · {percent}%
        </span>
        {isOffline && <span className="pill ok">Offline ready</span>}
      </div>
      <Link className="btn" to={`/learn/${course._id}`}>
        {cta}
      </Link>
    </article>
  );
}

function SkeletonDashboard() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>
      <div className="stats">
        {[0, 1, 2].map((i) => <div key={i} className="card stat skeleton" style={{ height: 76 }} />)}
      </div>
      <div className="grid">
        {[0, 1, 2].map((i) => <div key={i} className="card skeleton" style={{ height: 180 }} />)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, notifications = [] } = useAuth();
  const [data, setData] = useState(null);
  const [offlineIds, setOfflineIds] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | offline | error

  const load = useCallback(() => {
    let cancelled = false;
    setStatus('loading');

    listOfflineCourseIds(user.id)
      .then((ids) => !cancelled && setOfflineIds(ids))
      .catch(() => {});

    api('/learning/dashboard')
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus(e?.status === 0 || !navigator.onLine ? 'offline' : 'error');
      });

    return () => { cancelled = true; };
  }, [user.id]);

  useEffect(() => load(), [load]);

  // Reload automatically when the connection comes back
  useEffect(() => {
    const goOnline = () => load();
    window.addEventListener('online', goOnline);
    return () => window.removeEventListener('online', goOnline);
  }, [load]);

  const offlineSet = useMemo(() => new Set(offlineIds), [offlineIds]);

  // In progress first, then not started, then completed
  const { inProgress, notStarted, completed } = useMemo(() => {
    const courses = data?.courses ?? [];
    return {
      inProgress: courses.filter((c) => clamp(c.percent) > 0 && clamp(c.percent) < 100),
      notStarted: courses.filter((c) => clamp(c.percent) === 0),
      completed: courses.filter((c) => clamp(c.percent) === 100),
    };
  }, [data]);

  const resume = inProgress[0];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const firstName = user.name?.trim().split(' ')[0] || 'there';

  return (
    <>
      <h1>{greeting()}, {firstName} 👋</h1>

      <LiveBanner />

      {status === 'offline' && (
        <div className="card notice" role="status">
          <strong>You're offline.</strong> Your downloaded courses still work.
          <div className="list">
            {offlineIds.length === 0 && (
              <p className="muted">No courses are downloaded on this device yet.</p>
            )}
            {offlineIds.map((id) => (
              <Link key={id} className="btn small" to={`/learn/${id}`}>Open downloaded course</Link>
            ))}
          </div>
          <button className="btn small" onClick={load}>Try again</button>
        </div>
      )}

      {status === 'error' && (
        <div className="card notice" role="alert">
          <p>We couldn't load your dashboard. Check your connection and try again.</p>
          <button className="btn small" onClick={load}>Reload dashboard</button>
        </div>
      )}

      {status === 'loading' && <SkeletonDashboard />}

      {status === 'ready' && data && (
        <>
          {resume && (
            <section className="card resume" aria-labelledby="resume-h">
              <h2 id="resume-h">Pick up where you left off</h2>
              <p><strong>{resume.course.title}</strong></p>
              <ProgressBar percent={clamp(resume.percent)} label="Current course progress" />
              <div className="row">
                <span className="muted">
                  {resume.completedLessons}/{resume.totalLessons} lessons
                </span>
                <Link className="btn" to={`/learn/${resume.course._id}`}>Continue</Link>
              </div>
            </section>
          )}

          <div className="stats">
            <div className="card stat"><b>{data.stats.enrolled}</b><span>Courses</span></div>
            <div className="card stat"><b>{data.stats.lessonsDone}</b><span>Lessons done</span></div>
            <div className="card stat"><b>{data.stats.completed}</b><span>Completed</span></div>
          </div>

          <h2>My courses</h2>
          {data.courses.length === 0 ? (
            <div className="card center">
              <p>You haven't enrolled in a course yet.</p>
              <Link className="btn" to="/courses">Browse courses</Link>
            </div>
          ) : (
            <>
              {[
                ['In progress', inProgress],
                ['Not started', notStarted],
                ['Completed', completed],
              ].map(([label, items]) =>
                items.length ? (
                  <section key={label} aria-label={label}>
                    <h3 className="muted">{label} ({items.length})</h3>
                    <div className="grid">
                      {items.map((c) => (
                        <CourseTile key={c.enrollmentId} item={c} isOffline={offlineSet.has(c.course._id)} />
                      ))}
                    </div>
                  </section>
                ) : null
              )}
            </>
          )}

          <h2>
            Recent alerts
            {unreadCount > 0 && <span className="pill"> {unreadCount} new</span>}
          </h2>
          <div className="card">
            {notifications.length === 0 ? (
              <p className="muted">No alerts yet. We'll show course updates here.</p>
            ) : (
              notifications.slice(0, 4).map((n) => (
                <div key={n._id} className={`note ${n.read ? '' : 'unread'}`}>
                  {!n.read && <span className="sr-only">Unread: </span>}
                  <strong>{n.title}</strong>
                  <span className="muted">{n.message}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
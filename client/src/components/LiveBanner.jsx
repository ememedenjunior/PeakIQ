import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** "Live now" banners for the learner's own courses. Pass courseId to show only that course's class. */
export default function LiveBanner({ courseId }) {
  const { liveNow } = useAuth();
  const sessions = courseId ? liveNow.filter((s) => (s.course ? s.course._id : s.courseId) === courseId) : liveNow;
  if (!sessions.length) return null;

  return (
    <section aria-label="Live classes happening now">
      {sessions.map((s) => (
        <div key={s.id} className="live-banner" role="status">
          <div>
            <span className="live-pill static"><span className="live-dot" aria-hidden="true" /> LIVE NOW</span>
            <strong style={{ marginLeft: 10 }}>{s.title}</strong>
            <p>{s.course ? s.course.title : s.courseTitle}</p>
          </div>
          <Link className="btn accent" to={`/live/${s.id}`}>Join class</Link>
        </div>
      ))}
    </section>
  );
}

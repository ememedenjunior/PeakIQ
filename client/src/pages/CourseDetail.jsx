import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { trackLabel } from '../components/CourseCard.jsx';
import { api, naira } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';

export default function CourseDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  // The server tells us whether this person already has the course (it knows who is asking)
  useEffect(() => {
    api(`/courses/${slug}`).then(setCourse).catch((e) => setError(e.message));
  }, [slug, user?.id]);

  const owned = !!course?.enrolled;

  async function buy() {
    if (!user) return navigate('/login', { state: { from: `/courses/${slug}` } });
    setPaying(true);
    setError('');
    try {
      const res = await api('/payments/initialize', { method: 'POST', body: { courseId: course._id } });
      if (res.enrolled) return navigate(`/learn/${course._id}`); // free course: nothing to pay
      window.location.href = res.authorizationUrl; // hosted Paystack checkout
    } catch (e) {
      setError(e.message);
      setPaying(false);
    }
  }

  if (error && !course) return <p className="error">{error}</p>;
  if (!course) return <p className="muted">Loading…</p>;

  return (
    <div className="detail">
      <div>
        <span className={`pill ${course.track}`}>{trackLabel(course.track)}</span>
        <h1>{course.title}</h1>
        <p className="lead">{course.summary}</p>

        {course.track === 'algo-trading' && (
          <p className="risk" role="note">
            Trading involves risk and you can lose money. This course teaches engineering and risk discipline. It is not financial advice and does not promise returns.
          </p>
        )}

        <h2>What you will learn</h2>
        <ul className="ticks">{(course.outcomes || []).map((o) => <li key={o}>{o}</li>)}</ul>

        <h2>Course outline</h2>
        {course.modules.map((m, i) => (
          <details key={m._id} className="module" open={i === 0}>
            <summary>{`Module ${i + 1}: ${m.title}`}</summary>
            <ul>
              {m.lessons.map((l) => (
                <li key={l._id}>
                  <span>{l.title}</span>
                  <span className="muted">
                    {l.durationMins} min{' '}
                    {l.isPreview ? <button className="link" onClick={() => setPreview(l)}>Free preview</button> : '🔒'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}

        {preview && (
          <div className="card preview">
            <div className="row"><h3>{preview.title}</h3><button className="link" onClick={() => setPreview(null)}>Close</button></div>
            {preview.videoUrl && <video controls preload="metadata" src={preview.videoUrl} className="video" />}
            <div className="prose"><ReactMarkdown>{preview.content}</ReactMarkdown></div>
          </div>
        )}
      </div>

      <aside className="card buybox">
        <div className="price">{course.price === 0 ? 'Free' : naira(course.price)}</div>
        <p className="muted">{course.lessonCount} lessons · {course.level}</p>
        {owned ? (
          <Link to={`/learn/${course._id}`} className="btn">Continue learning</Link>
        ) : (
          <button className="btn" onClick={buy} disabled={paying}>{paying ? (course.price === 0 ? 'Enrolling…' : 'Redirecting…') : course.price === 0 ? 'Enrol for free' : 'Enrol now'}</button>
        )}
        <ul className="ticks small">
          <li>Self-paced, lifetime access</li>
          <li>Download for offline learning</li>
          <li>Live classes with your instructor</li>
          {course.price > 0 && <li>Secure payment with Paystack</li>}
        </ul>
        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  );
}

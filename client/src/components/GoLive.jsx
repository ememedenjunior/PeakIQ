import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { liveApi } from '../lib/liveApi';

/**
 * Instructor's entry point to a live class. Shows "Go live" (with a title field), or "Rejoin"
 * when a session is already running for the course. Only students enrolled in the course can join it.
 */
export default function GoLive({ course, compact = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (course.liveSessionId) {
    return (
      <Link className="btn accent small" to={`/live/${course.liveSessionId}`}>
        <span className="live-dot" aria-hidden="true" style={{ background: 'var(--err)', marginRight: 6, display: 'inline-block' }} />
        Rejoin live class
      </Link>
    );
  }

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await liveApi.start(course._id, { title: title.trim() || undefined });
      navigate(`/live/${s.id}`);
    } catch (err) {
      if (err.status === 409 && err.sessionId) return navigate(`/live/${err.sessionId}`);
      setError(err.message || 'Could not start the class.');
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={`btn small ${compact ? 'ghost' : 'accent'}`} onClick={() => setOpen(true)}>
        Go live
      </button>
    );
  }

  return (
    <form className="ins-form" onSubmit={start} style={{ marginTop: 8 }}>
      <label>
        Class title
        <input
          autoFocus
          value={title}
          maxLength={120}
          placeholder={`${course.title} live class`}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {course.status !== 'published' && (
        <p className="muted">This course is still a draft, so no students are enrolled yet. Publish it first for students to join.</p>
      )}
      <p className="muted">Only students enrolled in this course will be able to join. They are notified when you start.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="btn small accent" disabled={busy}>{busy ? 'Starting…' : 'Start class'}</button>
        <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

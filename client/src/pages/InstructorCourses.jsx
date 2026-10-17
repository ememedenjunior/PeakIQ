import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GoLive from '../components/GoLive.jsx';
import { instructorApi } from '../lib/instructorApi';
import './Instructor.css';

const when = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function InstructorCourses() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', track: '', level: 'beginner' });

  useEffect(() => {
    instructorApi.listCourses().then(setCourses).catch((e) => setError(e.message || 'Could not load your courses'));
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const c = await instructorApi.createCourse(form);
      navigate(`/instructor/courses/${c._id}`);
    } catch (err) {
      setError(err.message || 'Could not create the course');
      setCreating(false);
    }
  };

  return (
    <div className="ins">
      <div className="ins-head">
        <h1>Your courses</h1>
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Cancel' : 'New course'}
        </button>
      </div>

      {error && <div className="card notice ins-msg err" role="alert">{error}</div>}

      {open && (
        <form className="card ins-form" onSubmit={create}>
          <label>
            Course title
            <input type="text" required autoFocus value={form.title} placeholder="e.g. Data Analysis with Python & SQL"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <div className="ins-cols">
            <label>
              Track
              <input type="text" value={form.track} placeholder="e.g. data-analysis"
                onChange={(e) => setForm({ ...form, track: e.target.value })} />
            </label>
            <label>
              Level
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
          </div>
          <p className="muted">You'll add modules, lessons, tests and tasks on the next screen.</p>
          <button className="btn" disabled={creating || !form.title.trim()}>{creating ? 'Creating…' : 'Create and start building'}</button>
        </form>
      )}

      {!courses && !error && <p className="muted" aria-live="polite">Loading your courses…</p>}

      {courses?.length === 0 && !open && (
        <div className="card center">
          <p>You haven't created a course yet.</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>Create your first course</button>
        </div>
      )}

      <div className="grid">
        {courses?.map((c) => (
          <article key={c._id} className="card course">
            <div className="row">
              <span className={`pill ${c.status === 'published' ? 'ok' : ''}`}>{c.status === 'published' ? 'Live' : 'Draft'}</span>
              <span className="muted">{c.level}</span>
            </div>
            <h3>{c.title}</h3>
            <p className="muted">
              {c.modules} {c.modules === 1 ? 'module' : 'modules'}, {c.lessons} {c.lessons === 1 ? 'lesson' : 'lessons'}. Updated {when(c.updatedAt)}.
            </p>
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <Link className="btn" to={`/instructor/courses/${c._id}`}>Edit course</Link>
              <GoLive course={c} compact />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
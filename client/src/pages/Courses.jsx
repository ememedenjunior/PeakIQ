import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import CourseCard from '../components/CourseCard.jsx';

const TRACKS = [
  ['', 'All'],
  ['data-analysis', 'Data analysis'],
  ['ai', 'AI'],
  ['web-development', 'Web development'],
  ['algo-trading', 'Algo trading'],
];

export default function Courses() {
  const [params, setParams] = useSearchParams();
  const track = params.get('track') || '';
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    setCourses(null);
    api('/courses')
      .then((d) => setCourses(Array.isArray(d) ? d : []))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c = { '': courses?.length || 0 };
    courses?.forEach((x) => { c[x.track] = (c[x.track] || 0) + 1; });
    return c;
  }, [courses]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (courses || []).filter(
      (c) => (!track || c.track === track) && (!q || `${c.title} ${c.summary}`.toLowerCase().includes(q))
    );
  }, [courses, track, query]);

  const pick = (value) => setParams(value ? { track: value } : {}, { replace: true });

  return (
    <>
      <header className="page-head">
        <h1>Courses</h1>
        <p>Self-paced courses in data analysis, AI, web development and algorithmic trading. Pay once, learn online or offline.</p>
      </header>

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Filter by track">
          {TRACKS.map(([value, label]) => (
            <button key={value} className={track === value ? 'active' : ''} aria-pressed={track === value} onClick={() => pick(value)}>
              {label}{courses && <i>{counts[value] || 0}</i>}
            </button>
          ))}
        </div>
        <label className="field search">
          <span className="sr-only">Search courses</span>
          <input type="search" placeholder="Search courses" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {error && (
        <div className="empty">
          <h3>We could not load the courses</h3>
          <p>{error}</p>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      )}

      {!courses && !error && (
        <div className="grid" aria-busy="true" aria-label="Loading courses">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        </div>
      )}

      {courses && visible.length > 0 && (
        <div className="grid">{visible.map((c) => <CourseCard key={c._id} course={c} />)}</div>
      )}

      {courses && visible.length === 0 && !error && (
        <div className="empty">
          <h3>{courses.length === 0 ? 'No courses are published yet' : 'No courses match your search'}</h3>
          <p>{courses.length === 0 ? 'Check back soon, new courses are on the way.' : 'Try a different word, or clear the filters to see every course.'}</p>
          {courses.length > 0 && <button className="btn ghost" onClick={() => { setQuery(''); pick(''); }}>Clear filters</button>}
        </div>
      )}
    </>
  );
}

import { Link } from 'react-router-dom';
import { naira } from '../lib/api';
import ContourArt from './ContourArt.jsx';

const TRACK_LABEL = { 'data-analysis': 'Data analysis', ai: 'Artificial intelligence', 'web-development': 'Web development', 'algo-trading': 'Algorithmic trading' };
export const trackLabel = (t) => TRACK_LABEL[t] || t;

export default function CourseCard({ course }) {
  return (
    <Link to={`/courses/${course.slug}`} className={`course-card ${course.track}`}>
      <div className="tile"><ContourArt variant="tile" seed={course.slug} /></div>
      <div className="body">
        <span className={`pill ${course.track}`}>{trackLabel(course.track)}</span>
        <h3>{course.title}</h3>
        <p>{course.summary}</p>
        <div className="foot">
          <span className="meta">{course.lessonCount} lessons, {course.level}</span>
          <span className="price">{naira(course.price)}</span>
        </div>
      </div>
    </Link>
  );
}

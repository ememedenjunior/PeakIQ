import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <Logo light />
          <p>PeakIQ is a technology innovation hub that turns ideas into startups, starting with the skills to build them.</p>
        </div>
        <ul>
          <li><Link to="/courses">Courses</Link></li>
          <li><Link to="/courses?track=data-analysis">Data analysis</Link></li>
          <li><Link to="/courses?track=ai">AI</Link></li>
          <li><Link to="/courses?track=web-development">Web development</Link></li>
          <li><Link to="/courses?track=algo-trading">Algo trading</Link></li>
          <li><Link to="/login">Log in</Link></li>
        </ul>
        <small>© {new Date().getFullYear()} PeakIQ. All rights reserved.</small>
      </div>
    </footer>
  );
}

import { Link, NavLink, useNavigate } from 'react-router-dom';
import { isStaff, useAuth } from '../context/AuthContext.jsx';
import Logo from './Logo.jsx';

export default function Navbar() {
  const { user, logout, unread, liveNow } = useAuth();
  const navigate = useNavigate();
  // One live class: go straight in. Several: the dashboard lists them all.
  const liveTarget = liveNow.length === 1 ? `/live/${liveNow[0].id}` : '/dashboard';

  return (
    <header className="nav">
      <Logo />
      <nav aria-label="Main">
        <NavLink to="/courses">Courses</NavLink>
        {/* Full page load: the playground is served under its own security policy */}
        <NavLink to="/terminal" reloadDocument>Terminal</NavLink>
        {user ? (
          <>
            {liveNow.length > 0 && (
              <Link to={liveTarget} className="live-pill" aria-label={`${liveNow.length} live class${liveNow.length > 1 ? 'es' : ''} happening now`}>
                <span className="live-dot" aria-hidden="true" /> Live now
              </Link>
            )}
            <NavLink to="/dashboard">Dashboard</NavLink>
            {isStaff(user) && <NavLink to="/instructor">Instructor</NavLink>}
            <NavLink to="/notifications" className="bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              🔔{unread > 0 && <b className="badge">{unread > 9 ? '9+' : unread}</b>}
            </NavLink>
            <button className="link" onClick={() => { logout(); navigate('/'); }}>Log out</button>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <Link to="/register" className="btn small">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}

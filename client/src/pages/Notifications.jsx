import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Notifications() {
  const { notifications, unread, markAllRead } = useAuth();

  useEffect(() => {
    // clear the badge shortly after the page opens
    if (unread > 0) {
      const t = setTimeout(markAllRead, 1500);
      return () => clearTimeout(t);
    }
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="row"><h1>Notifications</h1><button className="link" onClick={markAllRead}>Mark all read</button></div>
      <div className="card">
        {notifications.length === 0 && <p className="muted">You are all caught up.</p>}
        {notifications.map((n) => (
          <div key={n._id} className={`note ${n.read ? '' : 'unread'}`}>
            <strong>{n.title}</strong>
            <span className="muted">{n.message}</span>
            <small className="muted">{new Date(n.createdAt).toLocaleString()}</small>
            {n.link && <Link to={n.link}>Open</Link>}
          </div>
        ))}
      </div>
    </>
  );
}

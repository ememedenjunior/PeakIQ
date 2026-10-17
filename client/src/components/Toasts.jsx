import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Toasts() {
  const { toasts } = useAuth();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <Link key={t._id} to={t.link || '/notifications'} className={`toast ${t.type}`}>
          <strong>{t.title}</strong>
          <span>{t.message}</span>
        </Link>
      ))}
    </div>
  );
}

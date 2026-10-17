import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ContourArt from '../components/ContourArt.jsx';

const BENEFITS = [
  'A free preview lesson in every course',
  'Secure payment with Paystack, access the moment it is confirmed',
  'Download paid courses and study offline',
];

export default function Login({ register = false }) {
  const { login, register: signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (register) await signUp(form.name.trim(), form.email.trim(), form.password);
      else await login(form.email.trim(), form.password);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="art"><ContourArt variant="aside" /></div>
        <div className="copy">
          <h2>{register ? 'Start learning at your own pace.' : 'Pick up where you left off.'}</h2>
          <ul>{BENEFITS.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      </aside>

      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <h1>{register ? 'Create your account' : 'Log in'}</h1>
          <p className="sub">{register ? 'It takes a minute. No payment needed to look around.' : 'Welcome back. Enter your details to continue.'}</p>

          {error && <div className="alert" role="alert">{error}</div>}

          {register && (
            <label className="field">
              Full name
              <input value={form.name} onChange={set('name')} required autoComplete="name" />
            </label>
          )}
          <label className="field">
            Email
            <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </label>
          <label className="field">
            Password {register && <span className="hint">(at least 8 characters)</span>}
            <span className="field-wrap">
              <input
                type={show ? 'text' : 'password'}
                minLength={register ? 8 : undefined}
                maxLength={72}
                value={form.password}
                onChange={set('password')}
                required
                autoComplete={register ? 'new-password' : 'current-password'}
              />
              <button type="button" className="link toggle" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Log in'}</button>

          <p className="alt">
            {register ? <>Already have an account? <Link to="/login" state={location.state}>Log in</Link></> : <>New to PeakIQ? <Link to="/register" state={location.state}>Create an account</Link></>}
          </p>
        </form>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

// Paystack redirects here with ?reference=...&trxref=...
export default function PaymentCallback() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('trxref');
  const [state, setState] = useState({ status: 'checking' });

  useEffect(() => {
    if (!reference) return setState({ status: 'error', message: 'Missing payment reference' });
    let tries = 0;
    let timer;
    const check = async () => {
      try {
        const r = await api(`/payments/verify/${reference}`);
        if (r.status === 'success') return setState({ status: 'success', courseId: r.courseId });
        if (r.status === 'failed') return setState({ status: 'failed' });
        if (++tries < 5) timer = setTimeout(check, 2000); // still pending, retry briefly
        else setState({ status: 'pending' });
      } catch (e) {
        setState({ status: 'error', message: e.message });
      }
    };
    check();
    return () => clearTimeout(timer);
  }, [reference]);

  return (
    <div className="card center auth">
      {state.status === 'checking' && <p>Confirming your payment…</p>}
      {state.status === 'success' && (
        <>
          <h2>Payment successful 🎉</h2>
          <p className="muted">You are enrolled. You can also download the course for offline use.</p>
          <Link className="btn" to={`/learn/${state.courseId}`}>Start learning</Link>
        </>
      )}
      {state.status === 'failed' && (
        <>
          <h2>Payment failed</h2>
          <p className="muted">No money was taken for this attempt.</p>
          <Link className="btn" to="/courses">Back to courses</Link>
        </>
      )}
      {state.status === 'pending' && (
        <>
          <h2>Still processing</h2>
          <p className="muted">We will notify you the moment the payment is confirmed.</p>
          <Link className="btn" to="/dashboard">Go to dashboard</Link>
        </>
      )}
      {state.status === 'error' && <p className="error">{state.message}</p>}
    </div>
  );
}

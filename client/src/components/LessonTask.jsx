import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';

/** Practical task: learner writes an answer, the instructor reviews it and leaves a grade and feedback. */
export default function LessonTask({ courseId, lessonId, onStatus }) {
  const [data, setData] = useState(undefined); // undefined = loading, null = no task
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/learning/courses/${courseId}/lessons/${lessonId}/task`;

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError('');
    api(base)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setAnswer(d?.submission?.answer || '');
        onStatus?.({ hasTask: !!d, submitted: !!(d && d.submission) });
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        if (e.status === 0) setError('Connect to the internet to view and submit this task.');
      });
    return () => { cancelled = true; };
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === undefined) return null;
  if (error) return <p className="notice card" role="alert">{error}</p>;
  if (!data) return null;

  const { task, submission } = data;
  const isLink = task.submissionType === 'link';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`${base}/submission`, { method: 'POST', body: { answer } });
      const fresh = await api(base);
      setData(fresh);
      onStatus?.({ hasTask: true, submitted: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card task" aria-labelledby="task-h">
      <h2 id="task-h">Practical task{task.required && <span className="pill"> Required</span>}</h2>
      <h3>{task.title}</h3>
      <div className="prose"><ReactMarkdown>{task.instructions}</ReactMarkdown></div>
      {task.rubric?.length > 0 && (
        <>
          <h4>How it will be marked</h4>
          <ul>{task.rubric.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </>
      )}

      {submission && (
        <div className="card notice" role="status">
          {submission.status === 'reviewed' ? (
            <>
              <strong>Reviewed: {submission.grade}%</strong>
              {submission.feedback && <p>{submission.feedback}</p>}
            </>
          ) : (
            <strong>Submitted. Your instructor will review it.</strong>
          )}
        </div>
      )}

      <form onSubmit={submit}>
        <label>
          {isLink ? 'Link to your work' : 'Your answer'}
          {isLink ? (
            <input type="url" required value={answer} placeholder="https://…" onChange={(e) => setAnswer(e.target.value)} />
          ) : (
            <textarea
              required
              rows={task.submissionType === 'code' ? 10 : 6}
              value={answer}
              spellCheck={task.submissionType !== 'code'}
              style={task.submissionType === 'code' ? { fontFamily: 'ui-monospace, monospace' } : undefined}
              onChange={(e) => setAnswer(e.target.value)}
            />
          )}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || !answer.trim()}>
          {busy ? 'Submitting…' : submission ? 'Resubmit' : 'Submit task'}
        </button>
        {submission && <p className="muted">Resubmitting replaces your earlier answer and sends it for review again.</p>}
      </form>
    </section>
  );
}

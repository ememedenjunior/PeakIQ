import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** End-of-lesson test. Questions arrive without answers; grading happens on the server. */
export default function LessonQuiz({ courseId, lessonId, onStatus }) {
  const [quiz, setQuiz] = useState(undefined); // undefined = loading, null = this lesson has no test
  const [error, setError] = useState('');
  const [picks, setPicks] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `/learning/courses/${courseId}/lessons/${lessonId}`;

  useEffect(() => {
    let cancelled = false;
    setQuiz(undefined);
    setError('');
    setResult(null);
    api(`${base}/quiz`)
      .then((q) => {
        if (cancelled) return;
        setQuiz(q);
        setPicks(q ? q.questions.map(() => []) : []);
        onStatus?.({ hasQuiz: !!q, passed: !!(q && q.best && q.best.passed) });
      })
      .catch((e) => {
        if (cancelled) return;
        setQuiz(null);
        setError(e.status === 0 ? 'Connect to the internet to take this test.' : e.message);
      });
    return () => { cancelled = true; };
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (quiz === undefined) return <p className="muted" aria-live="polite">Loading test…</p>;
  if (error) return <p className="notice card" role="alert">{error}</p>;
  if (!quiz) return null;

  const toggle = (qi, oi, single) =>
    setPicks((all) =>
      all.map((p, i) => {
        if (i !== qi) return p;
        if (single) return [oi];
        return p.includes(oi) ? p.filter((x) => x !== oi) : [...p, oi];
      })
    );

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(`${base}/quiz/attempt`, { method: 'POST', body: { answers: picks } });
      setResult(r);
      if (r.passed) onStatus?.({ hasQuiz: true, passed: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setResult(null);
    setPicks(quiz.questions.map(() => []));
  };

  const alreadyPassed = quiz.best && quiz.best.passed;
  const answered = picks.every((p) => p.length > 0);

  return (
    <section className="card quiz" aria-labelledby="quiz-h">
      <h2 id="quiz-h">Lesson test</h2>
      <p className="muted">Pass mark {quiz.passMark}%.{alreadyPassed && !result && ` You passed this test with ${quiz.best.score}%.`}</p>

      {result && (
        <div className={`card notice ${result.passed ? 'quiz-pass' : ''}`} role="status">
          <strong>{result.passed ? 'Passed' : 'Not quite'}: {result.score}%</strong> ({result.right} of {result.total} correct).
          {!result.passed && ' Review the lesson and try again.'}
        </div>
      )}

      <form onSubmit={submit}>
        {quiz.questions.map((q, qi) => {
          const graded = result && result.results[qi];
          return (
            <fieldset key={qi} className="quiz-q" disabled={!!result}>
              <legend>
                {qi + 1}. {q.prompt}{' '}
                {q.type === 'multiple' && <span className="muted">(choose all that apply)</span>}
              </legend>
              {q.options.map((opt, oi) => (
                <label key={oi} className="quiz-opt">
                  <input
                    type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                    name={`q${qi}`}
                    checked={picks[qi]?.includes(oi) || false}
                    onChange={() => toggle(qi, oi, q.type !== 'multiple')}
                  />
                  <span>{opt}</span>
                </label>
              ))}
              {graded && (
                <p className={graded.correct ? 'quiz-right' : 'error'}>
                  {graded.correct ? 'Correct.' : 'Incorrect.'} {graded.explanation}
                </p>
              )}
            </fieldset>
          );
        })}
        {!result ? (
          <button className="btn" disabled={busy || !answered}>{busy ? 'Checking…' : 'Submit answers'}</button>
        ) : (
          !result.passed && <button type="button" className="btn" onClick={retry}>Try again</button>
        )}
        {!result && !answered && <span className="muted"> Answer every question to submit.</span>}
      </form>
    </section>
  );
}

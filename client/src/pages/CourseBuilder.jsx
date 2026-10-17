import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { instructorApi, problemsOf } from '../lib/instructorApi';
import GoLive from '../components/GoLive.jsx';
import './Instructor.css';

/* ---------- helpers ---------- */

let counter = 0;
const tmp = () => `tmp-${++counter}`;
const isTmp = (id) => String(id).startsWith('tmp-');

const blankQuestion = () => ({ type: 'single', prompt: '', options: ['', ''], correct: [0], explanation: '' });
const blankLesson = () => ({ _id: tmp(), title: 'New lesson', content: '', videoUrl: '', durationMins: 10, isPreview: false, quiz: null, task: null });
const blankTask = () => ({ title: '', instructions: '', submissionType: 'code', language: 'python', rubric: [''], required: false });

const swap = (arr, i, j) => {
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
};

// Temporary client ids are dropped so the server assigns real ones
const toPayload = (c) => ({
  ...c,
  modules: c.modules.map((m) => ({
    ...m,
    _id: isTmp(m._id) ? undefined : m._id,
    lessons: m.lessons.map((l) => ({ ...l, _id: isTmp(l._id) ? undefined : l._id })),
  })),
});

/* ---------- lesson test editor ---------- */

function QuizEditor({ lesson, update }) {
  const quiz = lesson.quiz;

  if (!quiz) {
    return (
      <div className="ins-empty">
        <p>Learners take this test at the end of the lesson. Add questions that check what the lesson taught.</p>
        <button type="button" className="btn" onClick={() => update((l) => { l.quiz = { passMark: 70, questions: [blankQuestion()] }; })}>
          Add a test
        </button>
      </div>
    );
  }

  const q = (l, i) => l.quiz.questions[i];

  return (
    <div className="ins-form">
      <label className="ins-inline">
        Pass mark (%)
        <input type="number" min="0" max="100" value={quiz.passMark}
          onChange={(e) => update((l) => { l.quiz.passMark = e.target.value === '' ? '' : Number(e.target.value); })} />
      </label>

      {quiz.questions.map((question, qi) => (
        <fieldset key={qi} className="ins-q">
          <legend>Question {qi + 1}</legend>
          <textarea rows={2} placeholder="Write the question" aria-label={`Question ${qi + 1} text`} value={question.prompt}
            onChange={(e) => update((l) => { q(l, qi).prompt = e.target.value; })} />

          <div className="ins-row">
            <select aria-label="Answer type" value={question.type}
              onChange={(e) => update((l) => {
                const t = q(l, qi);
                t.type = e.target.value;
                if (t.type === 'single') t.correct = t.correct.slice(0, 1);
              })}>
              <option value="single">One correct answer</option>
              <option value="multiple">Several correct answers</option>
            </select>
            <span className="ins-grow" />
            <button type="button" className="ins-icon" aria-label="Move question up" onClick={() => update((l) => swap(l.quiz.questions, qi, qi - 1))}>↑</button>
            <button type="button" className="ins-icon" aria-label="Move question down" onClick={() => update((l) => swap(l.quiz.questions, qi, qi + 1))}>↓</button>
            <button type="button" className="ins-icon danger" aria-label="Delete question"
              onClick={() => update((l) => { l.quiz.questions.splice(qi, 1); if (!l.quiz.questions.length) l.quiz = null; })}>✕</button>
          </div>

          {question.options.map((opt, oi) => (
            <div className="ins-opt" key={oi}>
              <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={`q${qi}`}
                checked={question.correct.includes(oi)} aria-label={`Option ${oi + 1} is correct`}
                onChange={() => update((l) => {
                  const t = q(l, qi);
                  if (t.type === 'single') t.correct = [oi];
                  else t.correct = t.correct.includes(oi) ? t.correct.filter((i) => i !== oi) : [...t.correct, oi];
                })} />
              <input type="text" value={opt} placeholder={`Option ${oi + 1}`} aria-label={`Option ${oi + 1} text`}
                onChange={(e) => update((l) => { q(l, qi).options[oi] = e.target.value; })} />
              <button type="button" className="ins-icon" aria-label={`Remove option ${oi + 1}`} disabled={question.options.length <= 2}
                onClick={() => update((l) => {
                  const t = q(l, qi);
                  t.options.splice(oi, 1);
                  t.correct = t.correct.filter((i) => i !== oi).map((i) => (i > oi ? i - 1 : i));
                })}>✕</button>
            </div>
          ))}
          <div className="ins-row">
            <button type="button" className="ins-add" disabled={question.options.length >= 6}
              onClick={() => update((l) => { q(l, qi).options.push(''); })}>+ Add option</button>
          </div>
          <input type="text" placeholder="Explanation shown after answering (optional)" aria-label="Explanation" value={question.explanation}
            onChange={(e) => update((l) => { q(l, qi).explanation = e.target.value; })} />
        </fieldset>
      ))}

      <div className="ins-row">
        <button type="button" className="btn" onClick={() => update((l) => { l.quiz.questions.push(blankQuestion()); })}>+ Add question</button>
        <span className="ins-grow" />
        <button type="button" className="btn ghost danger" onClick={() => window.confirm('Remove this test?') && update((l) => { l.quiz = null; })}>Remove test</button>
      </div>
    </div>
  );
}

/* ---------- practical task editor ---------- */

function TaskEditor({ lesson, update }) {
  const t = lesson.task;

  if (!t) {
    return (
      <div className="ins-empty">
        <p>A practical task asks learners to apply the lesson, then submit their work for you to review.</p>
        <button type="button" className="btn" onClick={() => update((l) => { l.task = blankTask(); })}>Add a practical task</button>
      </div>
    );
  }

  const set = (k, v) => update((l) => { l.task[k] = v; });

  return (
    <div className="ins-form">
      <label>
        Task title
        <input type="text" value={t.title} placeholder="e.g. Clean the sales dataset" onChange={(e) => set('title', e.target.value)} />
      </label>
      <label>
        Instructions <span className="muted">(Markdown)</span>
        <textarea rows={8} value={t.instructions} onChange={(e) => set('instructions', e.target.value)} />
      </label>
      <div className="ins-cols">
        <label>
          Learners submit
          <select value={t.submissionType} onChange={(e) => set('submissionType', e.target.value)}>
            <option value="text">A written answer</option>
            <option value="code">Code</option>
            <option value="link">A link (GitHub, notebook, etc.)</option>
          </select>
        </label>
        {t.submissionType === 'code' && (
          <label>
            Language
            <select value={t.language} onChange={(e) => set('language', e.target.value)}>
              <option value="python">Python</option>
              <option value="sql">SQL</option>
              <option value="javascript">JavaScript</option>
              <option value="html">HTML &amp; CSS</option>
              <option value="other">Other</option>
            </select>
          </label>
        )}
      </div>
      <label>
        Marking guide <span className="muted">(one criterion per line)</span>
        <textarea rows={4} value={t.rubric.join('\n')} onChange={(e) => set('rubric', e.target.value.split('\n'))} />
      </label>
      <label className="ins-check">
        <input type="checkbox" checked={t.required} onChange={(e) => set('required', e.target.checked)} />
        Required: learners should submit this task to finish the lesson
      </label>
      <div className="ins-row">
        <button type="button" className="btn ghost danger" onClick={() => window.confirm('Remove this task?') && update((l) => { l.task = null; })}>Remove task</button>
      </div>
    </div>
  );
}

/* ---------- details tab ---------- */

function DetailsTab({ course, edit, onDelete }) {
  const set = (k) => (e) => edit((c) => { c[k] = e.target.value; });
  return (
    <div className="ins-form">
      <label>Title<input type="text" value={course.title} onChange={set('title')} /></label>
      <label>Summary<textarea rows={3} value={course.summary} onChange={set('summary')} /></label>
      <div className="ins-cols">
        <label>Track<input type="text" value={course.track} onChange={set('track')} /></label>
        <label>
          Level
          <select value={course.level} onChange={set('level')}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label>
          Price
          <input type="number" min="0" value={course.price}
            onChange={(e) => edit((c) => { c.price = e.target.value === '' ? '' : Number(e.target.value); })} />
        </label>
      </div>
      <label>
        What learners will be able to do <span className="muted">(one per line)</span>
        <textarea rows={4} value={course.outcomes.join('\n')} onChange={(e) => edit((c) => { c.outcomes = e.target.value.split('\n'); })} />
      </label>
      <div className="ins-row">
        <button type="button" className="btn ghost danger" onClick={onDelete}>Delete course</button>
      </div>
    </div>
  );
}

/* ---------- submissions tab ---------- */

function SubmissionCard({ s, onGraded }) {
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState(s.grade ?? '');
  const [feedback, setFeedback] = useState(s.feedback || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setSaving(true);
    setErr('');
    try {
      await instructorApi.grade(s._id, { grade, feedback });
      onGraded();
    } catch (e) {
      setErr(e.message || 'Could not save the grade');
      setSaving(false);
    }
  };

  return (
    <div className="card ins-sub">
      <button type="button" className="ins-subhead" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <strong>{s.user?.name || 'Learner'}</strong>
          <span className="muted"> on {s.taskTitle || s.lessonTitle}</span>
        </span>
        <span className={`pill ${s.status === 'reviewed' ? 'ok' : ''}`}>{s.status === 'reviewed' ? `Graded ${s.grade}%` : 'Needs review'}</span>
      </button>

      {open && (
        <div className="ins-form">
          {s.rubric?.length > 0 && (
            <div>
              <strong>Marking guide</strong>
              <ul>{s.rubric.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          <div>
            <strong>Submitted answer</strong>
            {s.submissionType === 'link' && /^https?:\/\//.test(s.answer)
              ? <p><a href={s.answer} target="_blank" rel="noopener noreferrer">{s.answer}</a></p>
              : <pre className="ins-answer">{s.answer}</pre>}
          </div>
          <div className="ins-cols">
            <label>Grade (0 to 100)<input type="number" min="0" max="100" value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
          </div>
          <label>Feedback for the learner<textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
          {err && <p className="ins-err" role="alert">{err}</p>}
          <div className="ins-row">
            <button type="button" className="btn" disabled={saving || grade === ''} onClick={submit}>{saving ? 'Saving…' : 'Save grade'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubmissionsTab({ courseId }) {
  const [filter, setFilter] = useState('submitted');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setItems(null);
    setError('');
    instructorApi.submissions(courseId, filter).then(setItems).catch((e) => setError(e.message || 'Could not load submissions'));
  }, [courseId, filter]);

  useEffect(load, [load]);

  return (
    <div>
      <div className="ins-seg" role="tablist" aria-label="Filter submissions">
        {[['submitted', 'Needs review'], ['reviewed', 'Graded'], ['', 'All']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>{label}</button>
        ))}
      </div>
      {error && <p className="ins-err" role="alert">{error}</p>}
      {!items && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">Nothing here yet. Submissions appear when learners finish a practical task.</p>}
      {items?.map((s) => <SubmissionCard key={s._id + s.status} s={s} onGraded={load} />)}
    </div>
  );
}

/* ---------- page ---------- */

export default function CourseBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [course, setCourse] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text, problems? }
  const [tab, setTab] = useState('curriculum');
  const [lessonTab, setLessonTab] = useState('content');
  const [sel, setSel] = useState({ m: 0, l: 0 });
  const editorRef = useRef(null);

  useEffect(() => {
    instructorApi.getCourse(id).then(setCourse).catch((e) => setLoadError(e.message || 'Could not load this course'));
  }, [id]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!['instructor', 'admin'].includes(user.role)) return <p className="muted">This area is for instructors.</p>;
  if (loadError) return <div className="ins"><p className="ins-err" role="alert">{loadError}</p><Link to="/instructor">Back to your courses</Link></div>;
  if (!course) return <p className="muted" aria-live="polite">Loading course…</p>;

  const live = course.status === 'published';
  const lesson = course.modules[sel.m]?.lessons[sel.l] || null;

  const edit = (fn) => {
    setCourse((c) => { const next = structuredClone(c); fn(next); return next; });
    setDirty(true);
    setMsg(null);
  };
  const updateLesson = (fn) => edit((c) => fn(c.modules[sel.m].lessons[sel.l]));

  const select = (m, l) => {
    setSel({ m, l });
    if (window.matchMedia('(max-width: 859px)').matches) editorRef.current?.scrollIntoView({ block: 'start' });
  };

  /* structure */
  const addModule = () => { edit((c) => c.modules.push({ _id: tmp(), title: 'New module', lessons: [] })); };
  const addLesson = (mi) => {
    const at = course.modules[mi].lessons.length;
    edit((c) => c.modules[mi].lessons.push(blankLesson()));
    setLessonTab('content');
    select(mi, at);
  };
  const moveModule = (mi, d) => {
    const j = mi + d;
    if (j < 0 || j >= course.modules.length) return;
    edit((c) => swap(c.modules, mi, j));
    setSel((s) => (s.m === mi ? { ...s, m: j } : s.m === j ? { ...s, m: mi } : s));
  };
  const moveLesson = (d) => {
    const { m, l } = sel;
    const j = l + d;
    if (j < 0 || j >= course.modules[m].lessons.length) return;
    edit((c) => swap(c.modules[m].lessons, l, j));
    setSel({ m, l: j });
  };
  const removeModule = (mi) => {
    if (!window.confirm(`Delete "${course.modules[mi].title}" and all its lessons?`)) return;
    edit((c) => c.modules.splice(mi, 1));
    setSel({ m: 0, l: 0 });
  };
  const removeLesson = () => {
    if (!window.confirm(`Delete "${lesson.title}"? Its test and task go with it.`)) return;
    edit((c) => c.modules[sel.m].lessons.splice(sel.l, 1));
    setSel({ m: sel.m, l: 0 });
  };

  /* save / publish / delete */
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await instructorApi.saveCourse(id, toPayload(course));
      setCourse(saved);
      setDirty(false);
      setMsg({ type: 'ok', text: 'Saved.' });
      return true;
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Could not save', problems: problemsOf(e) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (publish) => {
    if (dirty && !(await save())) return;
    try {
      await (publish ? instructorApi.publish(id) : instructorApi.unpublish(id));
      setCourse((c) => ({ ...c, status: publish ? 'published' : 'draft' }));
      setMsg({ type: 'ok', text: publish ? 'Published. Learners can now find this course.' : 'Moved back to draft. Learners can no longer see it.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Could not change the status', problems: problemsOf(e) });
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this course for good?')) return;
    try {
      await instructorApi.deleteCourse(id);
      setDirty(false);
      navigate('/instructor');
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Could not delete the course' });
    }
  };

  return (
    <div className="ins">
      <div className="ins-head">
        <div>
          <Link to="/instructor" className="muted">All courses</Link>
          <h1>
            {course.title || 'Untitled course'} <span className={`pill ${live ? 'ok' : ''}`}>{live ? 'Live' : 'Draft'}</span>
          </h1>
        </div>
        <div className="ins-actions">
          <GoLive course={course} compact />
          <button type="button" className="btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          {live ? (
            <button type="button" className="btn ghost" onClick={() => changeStatus(false)}>Unpublish</button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => changeStatus(true)} disabled={saving}>
              {dirty ? 'Save and publish' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`card notice ins-msg ${msg.type}`} role={msg.type === 'err' ? 'alert' : 'status'}>
          {msg.text}
          {msg.problems?.length > 0 && <ul>{msg.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        </div>
      )}

      <div className="ins-seg ins-tabs" role="tablist" aria-label="Course sections">
        {[['details', 'Details'], ['curriculum', 'Curriculum'], ['submissions', 'Submissions']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>{label}</button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab course={course} edit={edit} onDelete={remove} />}
      {tab === 'submissions' && <SubmissionsTab courseId={id} />}

      {tab === 'curriculum' && (
        <div className="ins-grid">
          <details className="ins-outline" open>
            <summary>Course outline</summary>
            <nav aria-label="Course outline">
              {course.modules.map((m, mi) => (
                <div key={m._id} className="ins-module">
                  <div className="ins-modhead">
                    <input type="text" aria-label={`Module ${mi + 1} title`} value={m.title}
                      onChange={(e) => edit((c) => { c.modules[mi].title = e.target.value; })} />
                    <button type="button" className="ins-icon" aria-label="Move module up" onClick={() => moveModule(mi, -1)}>↑</button>
                    <button type="button" className="ins-icon" aria-label="Move module down" onClick={() => moveModule(mi, 1)}>↓</button>
                    <button type="button" className="ins-icon danger" aria-label="Delete module" onClick={() => removeModule(mi)}>✕</button>
                  </div>
                  {m.lessons.map((l, li) => {
                    const count = l.quiz?.questions?.length || 0;
                    return (
                      <button key={l._id} type="button" className={`ins-lesson ${sel.m === mi && sel.l === li ? 'on' : ''}`}
                        aria-current={sel.m === mi && sel.l === li ? 'true' : undefined} onClick={() => select(mi, li)}>
                        <span className="ins-lname">{l.title || 'Untitled lesson'}</span>
                        <span className="ins-badges">
                          <b className={count ? 'ok' : 'warn'}>{count ? `Test (${count})` : 'No test'}</b>
                          {l.task && <b>Task</b>}
                        </span>
                      </button>
                    );
                  })}
                  <button type="button" className="ins-add" onClick={() => addLesson(mi)}>+ Add lesson</button>
                </div>
              ))}
              <button type="button" className="btn ghost" onClick={addModule}>+ Add module</button>
            </nav>
          </details>

          <section className="ins-editor" ref={editorRef} aria-label="Lesson editor">
            {lesson ? (
              <>
                <input type="text" className="ins-title" aria-label="Lesson title" value={lesson.title}
                  onChange={(e) => updateLesson((l) => { l.title = e.target.value; })} />
                <div className="ins-row">
                  <label className="ins-check">
                    <input type="checkbox" checked={lesson.isPreview} onChange={(e) => updateLesson((l) => { l.isPreview = e.target.checked; })} />
                    Free preview
                  </label>
                  <span className="ins-grow" />
                  <button type="button" className="ins-icon" aria-label="Move lesson up" onClick={() => moveLesson(-1)}>↑</button>
                  <button type="button" className="ins-icon" aria-label="Move lesson down" onClick={() => moveLesson(1)}>↓</button>
                  <button type="button" className="ins-icon danger" aria-label="Delete lesson" onClick={removeLesson}>✕</button>
                </div>

                <div className="ins-seg" role="tablist" aria-label="Lesson sections">
                  {[['content', 'Lesson'], ['test', 'Test'], ['task', 'Practical task']].map(([v, label]) => (
                    <button key={v} type="button" role="tab" aria-selected={lessonTab === v} onClick={() => setLessonTab(v)}>{label}</button>
                  ))}
                </div>

                {lessonTab === 'content' && (
                  <>
                    <div className="ins-cols">
                      <label>
                        Video link (optional)
                        <input type="url" value={lesson.videoUrl || ''} placeholder="https://… direct link to an .mp4 or .webm file"
                          onChange={(e) => updateLesson((l) => { l.videoUrl = e.target.value; })} />
                      </label>
                      <label>
                        Length (minutes)
                        <input type="number" min="0" max="600" value={lesson.durationMins ?? 10}
                          onChange={(e) => updateLesson((l) => { l.durationMins = e.target.value === '' ? '' : Number(e.target.value); })} />
                      </label>
                    </div>
                    <label>
                      <span className="muted">Lesson content in Markdown. Use # for headings and ``` for code blocks.</span>
                      <textarea className="ins-md" value={lesson.content} spellCheck
                        onChange={(e) => updateLesson((l) => { l.content = e.target.value; })} />
                    </label>
                  </>
                )}
                {lessonTab === 'test' && <QuizEditor lesson={lesson} update={updateLesson} />}
                {lessonTab === 'task' && <TaskEditor lesson={lesson} update={updateLesson} />}
              </>
            ) : (
              <p className="muted">Add a module, then a lesson, to start writing.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
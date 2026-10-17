import { useEffect, useMemo, useRef, useState } from 'react';
import './Playground.css';

/* ---------- config ---------- */

const LANGS = [
  { id: 'web', label: 'HTML & CSS' },
  { id: 'js', label: 'JavaScript' },
  { id: 'py', label: 'Python' },
];
const FILES = { html: 'index.html', css: 'style.css', js: 'script.js', py: 'main.py' };
const LIMIT = { js: 8000, py: 15000 }; // max run time (ms) before we stop the code
const STORE = 'playground:v1';
const KEYS = ['Tab', '(', ')', '[', ']', '{', '}', '"', "'", ':', '=', '_', '#', '<', '>', '/'];

const STARTERS = {
  html: [
    '<h1>Hello, learner 👋</h1>',
    '<p>Edit this page, then press <b>Run</b>.</p>',
    '<button id="btn">Click me</button>',
    '',
    '<script>',
    "  document.getElementById('btn').onclick = () => {",
    "    console.log('Button clicked!');",
    '  };',
    '</script>',
  ].join('\n'),
  css: [
    'body {',
    '  font-family: system-ui, sans-serif;',
    '  padding: 1.25rem;',
    '  line-height: 1.5;',
    '}',
    '',
    'h1 {',
    '  color: #0f766e;',
    '}',
    '',
    'button {',
    '  padding: 0.6rem 1rem;',
    '  font-size: 1rem;',
    '  border: 0;',
    '  border-radius: 8px;',
    '  background: #0f766e;',
    '  color: #fff;',
    '}',
  ].join('\n'),
  js: [
    '// Use console.log to print. Top-level await works too.',
    "const names = ['Ada', 'Grace', 'Linus'];",
    '',
    'for (const name of names) {',
    '  console.log(`Hello, ${name}!`);',
    '}',
    '',
    'const squares = [1, 2, 3, 4].map((n) => n * n);',
    "console.log('Squares:', squares);",
  ].join('\n'),
  py: [
    '# Use print() to show output.',
    '# input() reads from the Input box under the editor.',
    'names = ["Ada", "Grace", "Linus"]',
    '',
    'for name in names:',
    '    print(f"Hello, {name}!")',
    '',
    'squares = [n * n for n in range(1, 5)]',
    'print("Squares:", squares)',
  ].join('\n'),
};

/* ---------- worker sources (run off the main thread so loops can be stopped) ---------- */

const JS_WORKER = String.raw`
const fmt = (v) => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.name + ': ' + v.message;
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (typeof v === 'undefined') return 'undefined';
  if (typeof v === 'bigint') return v + 'n';
  try {
    const s = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x + 'n' : x), 2);
    return s === undefined ? String(v) : s;
  } catch (err) { return String(v); }
};
const send = (stream, args) =>
  postMessage({ type: 'out', stream, text: Array.prototype.map.call(args, fmt).join(' ') });
['log', 'info', 'debug', 'table', 'dir'].forEach((k) => { console[k] = (...a) => send('stdout', a); });
['warn', 'error'].forEach((k) => { console[k] = (...a) => send('stderr', a); });
const report = (err) =>
  postMessage({ type: 'out', stream: 'stderr', text: err && err.name ? err.name + ': ' + err.message : String(err) });

// Track timers so we only report "done" once everything scheduled has finished
const timers = new Set();
let mainDone = false;
const check = () => { if (mainDone && timers.size === 0) postMessage({ type: 'done' }); };
const _st = self.setTimeout.bind(self), _si = self.setInterval.bind(self);
const _ct = self.clearTimeout.bind(self), _ci = self.clearInterval.bind(self);
self.setTimeout = (fn, ms, ...a) => {
  const id = _st(async () => {
    timers.delete(id);
    try { await fn(...a); } catch (err) { report(err); }
    check();
  }, ms);
  timers.add(id);
  return id;
};
self.setInterval = (fn, ms, ...a) => {
  const id = _si(async () => { try { await fn(...a); } catch (err) { report(err); } }, ms);
  timers.add(id);
  return id;
};
self.clearTimeout = self.clearInterval = (id) => { _ct(id); _ci(id); timers.delete(id); check(); };
self.addEventListener('unhandledrejection', (ev) => report(ev.reason));

self.onmessage = async (e) => {
  postMessage({ type: 'running' });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(e.data.code)();
  } catch (err) { report(err); }
  mainDone = true;
  check();
};
`;

const PY_WORKER = String.raw`
const BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let py = null;
let stdinLines = [];
const out = (stream, text) => postMessage({ type: 'out', stream, text });

const ready = (async () => {
  importScripts(BASE + 'pyodide.js');
  py = await loadPyodide({ indexURL: BASE });
  py.setStdout({ batched: (t) => out('stdout', t) });
  py.setStderr({ batched: (t) => out('stderr', t) });
  py.setStdin({ stdin: () => (stdinLines.length ? stdinLines.shift() : undefined) });
  postMessage({ type: 'ready' });
})();
ready.catch(() =>
  postMessage({ type: 'fatal', text: 'Could not load Python. Check your connection and try again.' })
);

// Hide Pyodide's own stack frames so learners only see their code
const clean = (msg) => {
  const ls = msg.split('\n');
  const keep = [];
  for (let i = 0; i < ls.length; i++) {
    if (/^\s*File ".*_pyodide.*"/.test(ls[i])) {
      while (i + 1 < ls.length && /^\s{4,}/.test(ls[i + 1])) i++;
      continue;
    }
    keep.push(ls[i]);
  }
  return keep.join('\n').trim();
};

self.onmessage = async (e) => {
  try { await ready; } catch (err) { return; }
  stdinLines = e.data.stdin ? e.data.stdin.split('\n') : [];
  try {
    await py.loadPackagesFromImports(e.data.code, {
      messageCallback: (m) => postMessage({ type: 'status', text: m }),
      errorCallback: () => {},
    });
    postMessage({ type: 'running' });
    const g = py.globals.get('dict')();
    try { await py.runPythonAsync(e.data.code, { globals: g }); } finally { g.destroy(); }
  } catch (err) {
    out('stderr', clean(String(err && err.message ? err.message : err)));
  }
  postMessage({ type: 'done' });
};
`;

// Forwards console output from the HTML preview to our terminal
const BRIDGE =
  '<script>(function(){var f=function(x){if(typeof x==="string")return x;var r;try{r=JSON.stringify(x)}catch(e){}return r===undefined?String(x):r};' +
  'var p=function(s,a){try{parent.postMessage({pg:1,stream:s,text:[].map.call(a,f).join(" ")},"*")}catch(e){}};' +
  '["log","info","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){p(k==="warn"||k==="error"?"stderr":"stdout",arguments);o.apply(console,arguments)}});' +
  'addEventListener("error",function(e){p("stderr",[e.message])})})();</script>';

/* ---------- helpers ---------- */

function makeWorker(src) {
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return w;
}

function buildDoc(html, css) {
  const style = `<style>${css}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => BRIDGE + style + '</head>');
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${BRIDGE}${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BRIDGE}${style}</head><body>${html}</body></html>`;
}

function loadFiles() {
  try {
    return { ...STARTERS, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { ...STARTERS };
  }
}

function loadLang() {
  try {
    const l = localStorage.getItem(`${STORE}:lang`);
    return LANGS.some((x) => x.id === l) ? l : 'web';
  } catch {
    return 'web';
  }
}

/* ---------- terminal ---------- */

function Terminal({ lines, busy, label, onClear }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="pg-term">
      <div className="pg-term-head">
        <span>{label}</span>
        <button type="button" className="pg-link" onClick={onClear}>Clear</button>
      </div>
      <div className="pg-term-body" ref={ref} role="log" tabIndex={0} aria-label={label}>
        {lines.length === 0 && !busy && <div className="pg-dim">Press Run to see output here.</div>}
        {lines.map((l) => (
          <div key={l.id} className={`pg-line pg-${l.kind}`}>{l.text || '\u00a0'}</div>
        ))}
        {busy && <div className="pg-line pg-cursor" aria-hidden="true">▍</div>}
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function Playground() {
  const [files, setFiles] = useState(loadFiles);
  const [lang, setLang] = useState(loadLang);
  const [webFile, setWebFile] = useState('html');
  const [pane, setPane] = useState('code'); // mobile only: code | output
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | running
  const [pyState, setPyState] = useState('idle'); // idle | loading | ready
  const [stdin, setStdin] = useState('');
  const [doc, setDoc] = useState(() => buildDoc(files.html, files.css));
  const [runId, setRunId] = useState(0);

  const edRef = useRef(null);
  const gutRef = useRef(null);
  const iframeRef = useRef(null);
  const sessionRef = useRef(null);
  const pyRef = useRef(null);
  const bufRef = useRef([]);
  const rafRef = useRef(0);
  const idRef = useRef(1);
  const latest = useRef(() => {});
  const tabEscape = useRef(false);

  const activeKey = lang === 'web' ? webFile : lang;
  const code = files[activeKey];
  const unit = lang === 'py' ? '    ' : '  ';
  const busy = status !== 'idle';

  const gutter = useMemo(
    () => Array.from({ length: code.split('\n').length }, (_, i) => i + 1).join('\n'),
    [code]
  );

  /* persistence */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(files));
        localStorage.setItem(`${STORE}:lang`, lang);
      } catch { /* storage may be unavailable */ }
    }, 400);
    return () => clearTimeout(t);
  }, [files, lang]);

  /* console output coming from the HTML preview iframe */
  useEffect(() => {
    const onMessage = (e) => {
      if (!e.data?.pg || e.source !== iframeRef.current?.contentWindow) return;
      push(e.data.stream === 'stderr' ? 'stderr' : 'stdout', String(e.data.text));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* cleanup */
  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s) { clearTimeout(s.timer); s.worker.terminate(); }
      pyRef.current?.terminate();
      cancelAnimationFrame(rafRef.current);
    },
    []
  );

  /* ---- output buffering (keeps the UI smooth when code prints a lot) ---- */
  function push(kind, text) {
    bufRef.current.push({ id: idRef.current++, kind, text });
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const batch = bufRef.current;
      bufRef.current = [];
      setLines((prev) => [...prev, ...batch].slice(-500));
    });
  }

  function clearOutput() {
    bufRef.current = [];
    setLines([]);
  }

  /* ---- run lifecycle ---- */
  function endRun() {
    const s = sessionRef.current;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.kind === 'js') s.worker.terminate();
    const secs = ((performance.now() - (s.started ?? s.t0)) / 1000).toFixed(2);
    push('ok', `Finished in ${secs}s`);
    sessionRef.current = null;
    setStatus('idle');
  }

  function stop(message = 'Stopped.', kind = 'info') {
    const s = sessionRef.current;
    if (!s) return;
    clearTimeout(s.timer);
    s.worker.terminate();
    if (s.kind === 'py') {
      pyRef.current = null; // the next Python run starts a fresh runtime
      setPyState('idle');
    }
    push(kind, message);
    sessionRef.current = null;
    setStatus('idle');
  }

  function onMsg(d) {
    const s = sessionRef.current;
    switch (d.type) {
      case 'ready':
        setPyState('ready');
        break;
      case 'status':
        push('info', d.text);
        break;
      case 'out':
        if (!s) break;
        push(d.stream, d.text);
        if (++s.count > 3000) stop('Stopped: too much output.', 'stderr');
        break;
      case 'running':
        if (!s) break;
        s.started = performance.now();
        setStatus('running');
        s.timer = setTimeout(
          () => stop(`Stopped: your code ran for more than ${s.limit / 1000} seconds. Check for an infinite loop.`, 'stderr'),
          s.limit
        );
        break;
      case 'done':
        endRun();
        break;
      case 'fatal':
        push('stderr', d.text);
        pyRef.current?.terminate();
        pyRef.current = null;
        setPyState('idle');
        if (s) {
          clearTimeout(s.timer);
          sessionRef.current = null;
          setStatus('idle');
        }
        break;
      default:
    }
  }
  latest.current = onMsg;

  function attach(worker) {
    worker.onmessage = (e) => latest.current(e.data);
    worker.onerror = (e) => latest.current({ type: 'fatal', text: e.message || 'The code runner crashed.' });
    return worker;
  }

  function getPython() {
    if (!pyRef.current) {
      setPyState('loading');
      pyRef.current = attach(makeWorker(PY_WORKER));
    }
    return pyRef.current;
  }

  function run() {
    if (busy) return;
    setPane('output');

    if (lang === 'web') {
      clearOutput();
      setDoc(buildDoc(files.html, files.css));
      setRunId((n) => n + 1);
      return;
    }

    let worker;
    try {
      worker = lang === 'js' ? attach(makeWorker(JS_WORKER)) : getPython();
    } catch {
      push('stderr', 'This browser could not start the code runner.');
      return;
    }

    push('cmd', lang === 'js' ? '$ run script.js' : '$ python main.py');
    if (lang === 'py' && pyState !== 'ready') push('info', 'Loading Python (first run only)…');
    sessionRef.current = { kind: lang, worker, limit: LIMIT[lang], t0: performance.now(), count: 0, timer: 0 };
    setStatus('loading');
    worker.postMessage({ code: files[lang], stdin });
  }

  /* ---- editor behaviour ---- */
  function setCode(v) {
    setFiles((f) => ({ ...f, [activeKey]: v }));
  }

  function insert(text) {
    const el = edRef.current;
    if (!el) return;
    el.focus();
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    setCode(el.value);
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
      return;
    }
    if (e.key === 'Escape') {
      tabEscape.current = true; // lets keyboard users Tab out of the editor
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      if (tabEscape.current) { tabEscape.current = false; return; }
      e.preventDefault();
      insert(unit);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = e.currentTarget;
      const pos = el.selectionStart;
      const before = el.value.slice(el.value.lastIndexOf('\n', Math.max(pos - 1, 0)) + 1, pos);
      const indent = before.match(/^[ \t]*/)[0];
      const opener = lang === 'py' ? /[:{(\[]\s*$/ : /[{(\[]\s*$/;
      e.preventDefault();
      insert('\n' + indent + (opener.test(before) ? unit : ''));
    }
  }

  function reset() {
    if (window.confirm(`Reset ${FILES[activeKey]} to the starter code?`)) setCode(STARTERS[activeKey]);
  }

  function switchLang(id) {
    if (busy) stop('Stopped.');
    setLang(id);
    setPane('code');
  }

  const pyNote =
    pyState === 'ready' ? 'Python ready' : pyState === 'loading' ? 'Loading Python…' : 'Loads on first run (about 10 MB, then cached)';

  return (
    <>
      <h1>Playground</h1>
      <p className="muted">Write code, press Run, see what happens. Your work is saved on this device.</p>

      <div className="pg">
        <div className="pg-bar">
          <div className="pg-seg" role="tablist" aria-label="Language">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={lang === l.id}
                onClick={() => switchLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="pg-actions">
            {busy ? (
              <button type="button" className="pg-btn pg-stop" onClick={() => stop('Stopped.')}>Stop</button>
            ) : (
              <button type="button" className="pg-btn pg-run" onClick={run} title="Ctrl/⌘ + Enter">▶ Run</button>
            )}
            <button type="button" className="pg-btn pg-ghost" onClick={reset}>Reset</button>
          </div>

          <div className="pg-seg pg-panes" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={pane === 'code'} onClick={() => setPane('code')}>Code</button>
            <button type="button" role="tab" aria-selected={pane === 'output'} onClick={() => setPane('output')}>Output</button>
          </div>
        </div>

        <div className="pg-main">
          {/* editor */}
          <section className="pg-pane" data-active={pane === 'code'} aria-label="Code editor">
            <div className="pg-filebar">
              {lang === 'web' ? (
                <div role="tablist" aria-label="Files" className="pg-files">
                  {['html', 'css'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={webFile === f}
                      onClick={() => setWebFile(f)}
                    >
                      {FILES[f]}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="pg-file">{FILES[lang]}</span>
              )}
              {lang === 'py' && <span className="pg-dim pg-note">{pyNote}</span>}
            </div>

            <div className="pg-editor">
              <pre className="pg-gutter" ref={gutRef} aria-hidden="true">{gutter}</pre>
              <textarea
                key={activeKey}
                ref={edRef}
                className="pg-ta"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => { tabEscape.current = false; }}
                onScroll={(e) => { if (gutRef.current) gutRef.current.scrollTop = e.currentTarget.scrollTop; }}
                aria-label={`${FILES[activeKey]} editor. Press Escape then Tab to leave the editor.`}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                wrap="off"
              />
            </div>

            <div className="pg-keys" aria-label="Quick keys">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => insert(k === 'Tab' ? unit : k)}
                >
                  {k}
                </button>
              ))}
            </div>

            {lang === 'py' && (
              <details className="pg-stdin">
                <summary>Input for input()</summary>
                <textarea
                  rows={3}
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="One line per input() call"
                  aria-label="Input for input()"
                  spellCheck={false}
                />
              </details>
            )}
          </section>

          {/* output */}
          <section className="pg-pane" data-active={pane === 'output'} aria-label="Output">
            {lang === 'web' ? (
              <>
                <div className="pg-preview">
                  <iframe
                    key={runId}
                    ref={iframeRef}
                    title="Page preview"
                    sandbox="allow-scripts allow-forms allow-modals"
                    srcDoc={doc}
                  />
                </div>
                {lines.length > 0 && (
                  <div className="pg-console">
                    <Terminal lines={lines} busy={false} label="Console" onClear={clearOutput} />
                  </div>
                )}
              </>
            ) : (
              <Terminal lines={lines} busy={busy} label="Terminal" onClear={clearOutput} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
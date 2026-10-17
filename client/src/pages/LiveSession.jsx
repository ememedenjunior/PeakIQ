import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { liveApi } from '../lib/liveApi';
import { Broadcaster, Receiver, describeMediaError, mediaSupported } from '../lib/webrtc';
import './Live.css';

const fmtClock = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
};

function useElapsed(startedAt, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : 0;
}

export default function LiveSession() {
  const { sessionId } = useParams();
  const { socket } = useAuth();
  const navigate = useNavigate();

  const [info, setInfo] = useState(null); // { session, iceServers, maxViewers }
  const [problem, setProblem] = useState(null); // { message, code }
  const [phase, setPhase] = useState('loading'); // loading | live | ended | blocked
  const [role, setRole] = useState(null); // host | viewer
  const [hostOnline, setHostOnline] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [chat, setChat] = useState([]);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('chat');
  const [connState, setConnState] = useState('idle');
  const [videoActive, setVideoActive] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);

  // host media state
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [mediaError, setMediaError] = useState('');

  const [handUp, setHandUp] = useState(false);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef(null);
  const broadcaster = useRef(null);
  const receiver = useRef(null);
  const camStream = useRef(null);
  const screenTrack = useRef(null);
  const startingCam = useRef(false);

  const session = info && info.session;
  const elapsed = useElapsed(session && session.startedAt, phase === 'live');

  /* ---------- load the session (the server checks enrolment) ---------- */
  useEffect(() => {
    let cancelled = false;
    liveApi
      .get(sessionId)
      .then((d) => {
        if (cancelled) return;
        setInfo(d);
        setPhase(d.session.status === 'live' ? 'live' : 'ended');
      })
      .catch((e) => {
        if (cancelled) return;
        setProblem({ message: e.message, code: e.status });
        setPhase('blocked');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /* ---------- host: camera, microphone, screen ---------- */
  const startCamera = useCallback(async () => {
    if (startingCam.current) return;
    startingCam.current = true;
    setMediaError('');
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          // No camera: teach with microphone (and screen sharing) only
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCam(false);
        } else throw err;
      }
      camStream.current = stream;
      await broadcaster.current?.setTracks({
        audio: stream.getAudioTracks()[0] || null,
        video: screenTrack.current || stream.getVideoTracks()[0] || null,
      });
      if (videoRef.current && !screenTrack.current) videoRef.current.srcObject = stream;
      setMic(true);
    } catch (err) {
      setMediaError(describeMediaError(err));
    } finally {
      startingCam.current = false;
    }
  }, []);

  const stopShare = useCallback(async () => {
    const track = screenTrack.current;
    if (!track) return;
    track.onended = null;
    track.stop();
    screenTrack.current = null;
    setSharing(false);
    const camTrack = camStream.current && camStream.current.getVideoTracks()[0];
    await broadcaster.current?.setTracks({ video: camTrack || null, screen: false });
    if (videoRef.current && camStream.current) videoRef.current.srcObject = camStream.current;
  }, []);

  const toggleShare = async () => {
    if (sharing) return stopShare();
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      const track = display.getVideoTracks()[0];
      track.onended = stopShare; // the browser's own "Stop sharing" button
      screenTrack.current = track;
      setSharing(true);
      await broadcaster.current?.setTracks({ video: track, screen: true });
      if (videoRef.current) videoRef.current.srcObject = new MediaStream([track]);
    } catch (err) {
      if (err.name !== 'NotAllowedError') setMediaError('Screen sharing is not available in this browser.');
    }
  };

  const toggleMic = () => {
    const track = camStream.current && camStream.current.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMic(track.enabled);
  };

  const toggleCam = async () => {
    const track = camStream.current && camStream.current.getVideoTracks()[0];
    if (!track) return;
    const next = !cam;
    setCam(next);
    track.enabled = next;
    // Sending no video at all (rather than black frames) lets students see a clear "video paused" message
    if (!screenTrack.current) await broadcaster.current?.setTracks({ video: next ? track : null });
  };

  /* ---------- socket: join, signalling, chat, moderation ---------- */
  useEffect(() => {
    if (!socket || !info || info.session.status !== 'live') return undefined;
    let closed = false;

    const asHost = info.session.isHost;
    const rtcBase = { socket, iceServers: info.iceServers };

    if (asHost && !broadcaster.current) {
      broadcaster.current = new Broadcaster({ ...rtcBase });
    }
    if (!asHost && !receiver.current) {
      receiver.current = new Receiver({
        ...rtcBase,
        onStream: (stream) => {
          const el = videoRef.current;
          if (!el) return;
          if (el.srcObject !== stream) el.srcObject = stream;
          el.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true)); // autoplay with sound can be blocked
        },
        onState: setConnState,
        onVideoActive: setVideoActive,
      });
    }

    const end = (message) => {
      setPhase('ended');
      setProblem(message ? { message } : null);
    };

    const join = () => {
      socket.emit('live:join', { sessionId }, (res) => {
        if (closed) return;
        if (!res || !res.ok) {
          setProblem({ message: (res && res.error) || 'Could not join this session.', code: res && res.code });
          setPhase(res && res.code === 'ended' ? 'ended' : 'blocked');
          return;
        }
        setRole(res.role);
        setHostOnline(res.hostOnline);
        setViewerCount(res.viewerCount);
        setChatEnabled(res.chatEnabled);
        setChat(res.chat || []);
        if (res.role === 'host') {
          setPeople(res.peers || []);
          // After a reconnect the old connections are dead: rebuild one per student
          (res.peers || []).forEach((p) => broadcaster.current?.addViewer(p.socketId).catch(() => {}));
        }
      });
    };

    const onSignal = ({ from, data }) => {
      if (asHost) broadcaster.current?.handleSignal(from, data);
      else receiver.current?.handleSignal(from, data);
    };
    const onViewerJoined = ({ socketId, user }) => {
      setPeople((p) => [...p.filter((x) => x.userId !== user.id), { socketId, userId: user.id, name: user.name, hand: false }]);
      broadcaster.current?.addViewer(socketId).catch(() => {});
    };
    const onViewerLeft = ({ socketId, userId }) => {
      broadcaster.current?.removeViewer(socketId);
      // Only drop the row if it still points at this connection (a refresh reuses the same person)
      setPeople((p) => p.filter((x) => !(x.userId === userId && x.socketId === socketId)));
    };
    const onHand = ({ userId, raised }) => setPeople((p) => p.map((x) => (x.userId === userId ? { ...x, hand: raised } : x)));

    const handlers = {
      'live:signal': onSignal,
      'live:viewer-joined': onViewerJoined,
      'live:viewer-left': onViewerLeft,
      'live:hand': onHand,
      'live:hand-lowered': () => setHandUp(false),
      'live:count': ({ viewers }) => setViewerCount(viewers),
      'live:host-status': ({ online }) => setHostOnline(online),
      'live:chat': (m) => setChat((c) => [...c.slice(-199), m]),
      'live:chat-status': ({ enabled }) => setChatEnabled(enabled),
      'live:ended': () => end(),
      'live:kicked': () => {
        setProblem({ message: 'The instructor removed you from this session.' });
        setPhase('blocked');
      },
      'live:replaced': () => {
        setProblem({ message: 'This session was opened in another tab or device, so it was closed here.' });
        setPhase('blocked');
      },
      connect: join,
    };
    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    if (socket.connected) join();

    return () => {
      closed = true;
      Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
      socket.emit('live:leave');
      broadcaster.current?.close();
      receiver.current?.close();
      broadcaster.current = null;
      receiver.current = null;
    };
  }, [socket, info, sessionId]);

  // Host: ask for camera and microphone once connected as host
  useEffect(() => {
    if (role === 'host' && !camStream.current && mediaSupported()) startCamera();
  }, [role, startCamera]);

  // Release the camera, microphone and screen when leaving the page or when the class ends
  useEffect(() => {
    if (phase === 'live') return undefined;
    stopAllMedia();
    return undefined;
  }, [phase]);
  useEffect(() => stopAllMedia, []);

  function stopAllMedia() {
    camStream.current?.getTracks().forEach((t) => t.stop());
    screenTrack.current?.stop();
    camStream.current = null;
    screenTrack.current = null;
  }

  // After the class: the instructor sees who attended
  useEffect(() => {
    if (phase === 'ended' && session && session.isHost) liveApi.attendance(sessionId).then(setSummary).catch(() => {});
  }, [phase, session, sessionId]);

  /* ---------- actions ---------- */
  const sendChat = (text) =>
    new Promise((resolve) => socket.emit('live:chat', { text }, (res) => resolve(res || { ok: false })));

  const endSession = async () => {
    if (!window.confirm('End this live class for everyone?')) return;
    setBusy(true);
    try {
      await liveApi.end(sessionId);
    } catch (e) {
      setProblem({ message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleHand = () => {
    const raised = !handUp;
    setHandUp(raised);
    socket.emit('live:hand', { raised });
  };

  const kick = (p) => {
    if (window.confirm(`Remove ${p.name} from this session? They will not be able to rejoin.`)) socket.emit('live:kick', { userId: p.userId });
  };

  const tapToPlay = () => videoRef.current && videoRef.current.play().then(() => setNeedsTap(false)).catch(() => {});
  const fullscreen = () => videoRef.current?.parentElement?.requestFullscreen?.();

  /* ---------- screens ---------- */
  if (phase === 'loading') return <p className="center muted">Loading live class…</p>;

  if (phase === 'blocked') {
    return (
      <div className="live-gate card" role="alert">
        <h2>You can't join this class</h2>
        <p>{problem ? problem.message : 'Something went wrong.'}</p>
        <button className="btn" onClick={() => navigate('/dashboard')}>Back to dashboard</button>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="live-gate card">
        <h2>This live class has ended</h2>
        {session && (
          <p className="muted">
            {session.title} · {session.course.title}
          </p>
        )}
        {problem && <p className="error">{problem.message}</p>}
        {summary && (
          <>
            <h3>Attendance ({summary.length})</h3>
            {summary.length === 0 ? (
              <p className="muted">No students joined.</p>
            ) : (
              <table className="live-table">
                <thead>
                  <tr><th>Student</th><th>Time in class</th></tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.user ? r.user.id : Math.random()}>
                      <td>{r.user ? r.user.name : 'Unknown'}</td>
                      <td>{Math.max(1, Math.round(r.totalSeconds / 60))} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <Link className="btn" to={session && session.isHost ? '/instructor' : '/dashboard'}>
            {session && session.isHost ? 'Back to my courses' : 'Back to dashboard'}
          </Link>
          {session && !session.isHost && (
            <Link className="btn ghost" to={`/learn/${session.course._id}`}>Continue the course</Link>
          )}
        </div>
      </div>
    );
  }

  const isHost = role === 'host';
  const waiting = !isHost && !hostOnline;

  return (
    <div className="live">
      <div className="live-main">
        <header className="live-head">
          <div>
            <h1>{session.title}</h1>
            <p className="muted">
              <Link to={`/courses/${session.course.slug}`}>{session.course.title}</Link> · with {session.host.name}
            </p>
          </div>
          <div className="live-meta" aria-live="off">
            <span className="live-pill static"><span className="live-dot" aria-hidden="true" /> LIVE</span>
            <span>{fmtClock(elapsed)}</span>
            <span>{viewerCount} watching</span>
          </div>
        </header>

        {!mediaSupported() && isHost && (
          <p className="notice" role="alert">This browser can't broadcast. Use a recent Chrome, Edge, Firefox or Safari over HTTPS.</p>
        )}
        {mediaError && (
          <p className="notice" role="alert">
            {mediaError} <button className="link" onClick={startCamera}>Try again</button>
          </p>
        )}

        <div className="live-stage">
          <video ref={videoRef} autoPlay playsInline muted={isHost} aria-label={isHost ? 'Your broadcast preview' : "Instructor's video"} />
          {waiting && (
            <div className="live-overlay"><p>Waiting for the instructor to reconnect…</p></div>
          )}
          {!isHost && !waiting && connState !== 'connected' && (
            <div className="live-overlay"><p>{connState === 'idle' || connState === 'connecting' ? 'Connecting to the class…' : 'Reconnecting…'}</p></div>
          )}
          {!isHost && !waiting && connState === 'connected' && !videoActive && (
            <div className="live-overlay"><p>The instructor's video is paused.</p></div>
          )}
          {needsTap && (
            <button className="live-overlay tap" onClick={tapToPlay}>Tap to start the class</button>
          )}
          {isHost && sharing && <span className="live-badge">Sharing your screen</span>}
        </div>

        <div className="live-controls" role="toolbar" aria-label="Class controls">
          {isHost ? (
            <>
              <button className={`btn small ${mic ? 'dark' : 'accent'}`} onClick={toggleMic} aria-pressed={!mic}>{mic ? 'Mute mic' : 'Unmute mic'}</button>
              <button className={`btn small ${cam ? 'dark' : 'accent'}`} onClick={toggleCam} aria-pressed={!cam} disabled={!camStream.current?.getVideoTracks().length}>
                {cam ? 'Camera off' : 'Camera on'}
              </button>
              <button className={`btn small ${sharing ? 'accent' : 'dark'}`} onClick={toggleShare} aria-pressed={sharing}>{sharing ? 'Stop sharing' : 'Share screen'}</button>
              <button className="btn small ghost" onClick={() => socket.emit('live:chat-toggle', { enabled: !chatEnabled })}>
                {chatEnabled ? 'Turn chat off' : 'Turn chat on'}
              </button>
              <span className="grow" />
              <button className="btn small danger" onClick={endSession} disabled={busy}>End class</button>
            </>
          ) : (
            <>
              <button className={`btn small ${handUp ? 'accent' : 'dark'}`} onClick={toggleHand} aria-pressed={handUp}>
                {handUp ? 'Lower hand' : '✋ Raise hand'}
              </button>
              <button className="btn small ghost" onClick={fullscreen}>Fullscreen</button>
              <span className="grow" />
              <button className="btn small ghost" onClick={() => navigate('/dashboard')}>Leave class</button>
            </>
          )}
        </div>
      </div>

      <aside className="live-side card">
        {isHost && (
          <div className="live-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat</button>
            <button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>
              People ({people.length}){people.some((p) => p.hand) && ' ✋'}
            </button>
          </div>
        )}
        {(!isHost || tab === 'chat') && (
          <ChatPanel messages={chat} enabled={chatEnabled || isHost} onSend={sendChat} />
        )}
        {isHost && tab === 'people' && (
          <ul className="live-people">
            {people.length === 0 && <li className="muted">No one has joined yet.</li>}
            {[...people].sort((a, b) => Number(b.hand) - Number(a.hand)).map((p) => (
              <li key={p.userId}>
                <span>{p.hand && '✋ '}{p.name}</span>
                <span className="live-actions">
                  {p.hand && <button className="link" onClick={() => socket.emit('live:lower-hand', { userId: p.userId })}>Lower hand</button>}
                  <button className="link danger-text" onClick={() => kick(p)}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function ChatPanel({ messages, enabled, onSend }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const pinned = useRef(true);

  // Stay at the newest message, unless the person scrolled up to read earlier ones
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const res = await onSend(value);
    if (res.ok) {
      setText('');
      setError('');
    } else setError(res.error || 'Message not sent.');
  };

  return (
    <div className="live-chat">
      <div
        className="live-log"
        ref={listRef}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <p className="muted">No messages yet. Say hello 👋</p>}
        {messages.map((m) => (
          <p key={m.id} className={m.role === 'host' ? 'from-host' : undefined}>
            <strong>{m.name}{m.role === 'host' && ' (instructor)'}</strong> {m.text}
          </p>
        ))}
      </div>
      {error && <p className="error live-err" role="alert">{error}</p>}
      <form onSubmit={submit} className="live-compose">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={enabled ? 'Ask a question…' : 'Chat is turned off'}
          disabled={!enabled}
          aria-label="Chat message"
        />
        <button className="btn small" disabled={!enabled || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

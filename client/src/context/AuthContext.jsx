import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, setToken, API_BASE } from '../lib/api';
import { liveApi } from '../lib/liveApi';
import { flushProgressQueue } from '../lib/offline';

const AuthContext = createContext(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>. Wrap <App /> with it in main.jsx.');
  return ctx;
};

const USER_KEY = 'peakiq_user';
const cachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};

export const isStaff = (user) => !!user && ['instructor', 'admin'].includes(user.role);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(cachedUser);
  const [loading, setLoading] = useState(!!getToken());
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [liveNow, setLiveNow] = useState([]); // live sessions in my courses right now
  const [socket, setSocket] = useState(null);
  const timers = useRef(new Set());

  const saveUser = (u) => {
    setUser(u);
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  };

  const logout = useCallback(() => {
    setToken(null);
    saveUser(null);
    setNotifications([]);
    setUnread(0);
    setLiveNow([]);
  }, []);

  // Restore session. When offline we trust the cached user so downloaded courses still open.
  useEffect(() => {
    if (!getToken()) return setLoading(false);
    api('/auth/me')
      .then((d) => saveUser(d.user))
      .catch((e) => {
        if (e.status !== 0) logout();
      })
      .finally(() => setLoading(false));
  }, [logout]);

  // Any API call answered with 401 means the session expired: sign out cleanly.
  useEffect(() => {
    window.addEventListener('peakiq:unauthorized', logout);
    return () => window.removeEventListener('peakiq:unauthorized', logout);
  }, [logout]);

  const loadNotifications = useCallback(async () => {
    try {
      const d = await api('/notifications');
      setNotifications(d.items);
      setUnread(d.unread);
    } catch {
      /* offline */
    }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      setLiveNow(await liveApi.active());
    } catch {
      /* offline */
    }
  }, []);

  const toast = useCallback((n) => {
    const id = n._id || `${Date.now()}${Math.random()}`;
    setToasts((t) => [...t, { ...n, _id: id }]);
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x._id !== id));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Real-time channel: one authenticated socket per signed-in user
  useEffect(() => {
    if (!user || !getToken()) return;
    loadNotifications();
    loadLive();
    // auth is a function so every reconnect uses the CURRENT token, not the one from first connect
    const s = io(API_BASE || undefined, { auth: (cb) => cb({ token: getToken() }) });
    setSocket(s);

    s.on('notification', (n) => {
      setNotifications((prev) => [n, ...prev]);
      setUnread((u) => u + 1);
      toast(n);
    });
    s.on('live:started', (session) => setLiveNow((prev) => [...prev.filter((x) => x.id !== session.id), session]));
    s.on('live:ended', ({ id }) => setLiveNow((prev) => prev.filter((x) => x.id !== id)));
    s.on('connect', loadLive); // catch up on anything missed while disconnected

    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [user?.id, loadNotifications, loadLive, toast]);

  // Sync progress made offline once the connection returns
  useEffect(() => {
    const sync = () => user && flushProgressQueue();
    window.addEventListener('online', sync);
    sync();
    return () => window.removeEventListener('online', sync);
  }, [user]);

  const authenticate = async (path, body) => {
    const d = await api(path, { method: 'POST', body });
    setToken(d.token);
    saveUser(d.user);
    return d.user;
  };

  const login = (email, password) => authenticate('/auth/login', { email, password });
  const register = (name, email, password) => authenticate('/auth/register', { name, email, password });

  const markAllRead = async () => {
    setUnread(0);
    setNotifications((n) => n.map((x) => ({ ...x, read: true })));
    api('/notifications/read-all', { method: 'POST' }).catch(() => {});
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, notifications, unread, markAllRead, toasts, socket, liveNow, loadLive }}
    >
      {children}
    </AuthContext.Provider>
  );
}

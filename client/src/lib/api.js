const TOKEN_KEY = 'peakiq_token';

// Where the API lives. Empty means same origin: production behind one domain, or the Vite dev proxy.
// Set VITE_API_URL at build time only if the API is hosted on a different domain.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const TIMEOUT_MS = 20000;

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status; // 0 means the network itself failed (offline)
    this.data = data || null;
    this.problems = (data && data.problems) || []; // publish/save checks from the server
    this.sessionId = data && data.sessionId; // set when a live session is already running
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // status 0 still means "no network response", which the offline mode relies on
    throw new ApiError(
      navigator.onLine === false ? 'You appear to be offline' : 'Cannot reach the server. Check your connection and try again.',
      0
    );
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }

  if (!res.ok) {
    // An expired or revoked session: let the app sign the user out instead of leaving them on broken pages.
    if (res.status === 401 && token) window.dispatchEvent(new Event('peakiq:unauthorized'));
    throw new ApiError((data && data.message) || `Request failed (${res.status})`, res.status, data);
  }
  if (data === null) {
    // A 200 that is not JSON almost always means the request never reached the API
    throw new ApiError('The server sent an unexpected response. Please try again.', 502);
  }
  return data;
}

export const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

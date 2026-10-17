const path = require('path');
const fs = require('fs');

// dotenv is only needed for local development; in production the platform injects the environment.
try {
  require('dotenv').config();
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

const env = process.env;

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// "1" -> 1 hop, "true" -> trust all, "10.0.0.0/8" -> subnet. Needed so rate limiting sees real client IPs behind a proxy.
const parseTrustProxy = (value) => {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (['true', 'false'].includes(value.toLowerCase())) return value.toLowerCase() === 'true';
  return value;
};

const isProd = env.NODE_ENV === 'production';
const clientUrl = (env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
const clientDist = path.resolve(env.CLIENT_DIST || path.join(__dirname, '..', '..', 'client', 'dist'));

const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: int(env.PORT, 5000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/peakiq',
  jwtSecret: env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  clientUrl,
  extraOrigins: list(env.CORS_ORIGINS),
  paystackSecret: env.PAYSTACK_SECRET_KEY || '',
  trustProxy: parseTrustProxy(env.TRUST_PROXY),

  // Serve the built React app from this server (one domain, no CORS). Turn off if the client is hosted elsewhere.
  clientDist,
  serveClient: bool(env.SERVE_CLIENT, true) && fs.existsSync(path.join(clientDist, 'index.html')),

  // Product workflow: every lesson must end with a test before a course can go live.
  requireLessonQuiz: bool(env.REQUIRE_LESSON_QUIZ, true),

  // Content-Security-Policy. Set CSP_REPORT_ONLY=true to observe violations without blocking anything.
  cspReportOnly: bool(env.CSP_REPORT_ONLY, false),

  live: {
    // Media is relayed peer-to-peer from the instructor, so upload bandwidth caps the class size.
    maxViewers: int(env.LIVE_MAX_VIEWERS, 30),
    // How long a session survives without its instructor connected (refresh, Wi-Fi drop) before it ends itself.
    hostGraceSeconds: int(env.LIVE_HOST_GRACE_SECONDS, 90),
    // Hard stop so a forgotten session cannot run forever.
    maxHours: int(env.LIVE_MAX_HOURS, 6),
  },

  ice: {
    json: env.ICE_SERVERS || '', // full override: a JSON array of RTCIceServer objects
    stunUrls: list(env.STUN_URLS || 'stun:stun.l.google.com:19302'),
    turnUrls: list(env.TURN_URLS),
    turnSecret: env.TURN_SECRET || '', // coturn "use-auth-secret": short-lived credentials are derived per user
    turnUsername: env.TURN_USERNAME || '', // static credentials, used only when TURN_SECRET is not set
    turnCredential: env.TURN_CREDENTIAL || '',
    turnTtlSeconds: int(env.TURN_TTL_SECONDS, 6 * 60 * 60),
  },
};

// Browsers send an Origin header; allow the configured client plus any extra origins,
// and any localhost port outside production (Vite moves to 5174, 5175... when 5173 is busy).
config.isAllowedOrigin = (origin) =>
  !origin ||
  origin === config.clientUrl ||
  config.extraOrigins.includes(origin) ||
  (!config.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

/** Called once at boot. Collects every problem so a bad deploy fails with one clear message. */
config.assertValid = () => {
  if (!config.isProd) return;
  const problems = [];
  if (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random value of at least 32 characters (try: openssl rand -hex 48)');
  }
  if (!env.MONGODB_URI) problems.push('MONGODB_URI must be set');
  if (!env.CLIENT_URL) problems.push('CLIENT_URL must be set to the public URL of the site (used for payment redirects and CORS)');
  if (config.ice.turnUrls.length && !config.ice.turnSecret && !(config.ice.turnUsername && config.ice.turnCredential)) {
    problems.push('TURN_URLS is set but neither TURN_SECRET nor TURN_USERNAME/TURN_CREDENTIAL is');
  }
  if (problems.length) throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
  if (!config.paystackSecret) console.warn('[config] PAYSTACK_SECRET_KEY is not set: paid enrolment is disabled (free courses still work).');
  if (!config.ice.turnUrls.length && !config.ice.json) {
    console.warn('[config] No TURN server configured: some students behind strict firewalls will not be able to receive live video.');
  }
};

module.exports = config;

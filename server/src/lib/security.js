const helmet = require('helmet');
const config = require('../config');

const wsVariant = (url) => url.replace(/^http/, 'ws');

/**
 * Two Content-Security-Policy profiles.
 *  - app:        strict. No inline or eval'd script, only this origin.
 *  - playground: the /terminal page runs learners' own code (JS via a worker, Python via Pyodide from a CDN,
 *                an HTML preview with inline script), which cannot work under the strict policy.
 *                Learners' code stays isolated in sandboxed iframes/workers; the relaxed policy is limited to that page.
 */
function directives(profile) {
  const d = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    mediaSrc: ["'self'", 'blob:', 'https:'], // lesson videos are direct https links
    connectSrc: ["'self'", config.clientUrl, wsVariant(config.clientUrl)],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
  if (profile === 'playground') {
    d.scriptSrc.push("'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net');
    d.connectSrc.push('https://cdn.jsdelivr.net', 'https://pypi.org', 'https://files.pythonhosted.org');
    d.frameSrc = ["'self'", 'blob:', 'about:'];
  }
  return d;
}

const build = (profile) =>
  helmet({
    contentSecurityPolicy: { useDefaults: false, reportOnly: config.cspReportOnly, directives: directives(profile) },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });

const app = build('app');
const playground = build('playground');

const isPlayground = (path) => path === '/terminal' || path.startsWith('/terminal/');

/** Security headers for every response. */
function securityHeaders(req, res, next) {
  // Camera, microphone and screen capture are needed by live classes; everything else sensitive is off.
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=()'
  );
  return (isPlayground(req.path) ? playground : app)(req, res, next);
}

module.exports = { securityHeaders, isPlayground, directives };

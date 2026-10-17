const fs = require('fs');
const path = require('path');
const express = require('express');
require('express-async-errors'); // Express 4: forward rejected async handlers to the error middleware
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const config = require('./config');
const { securityHeaders, isPlayground } = require('./lib/security');
const sanitize = require('./middleware/sanitize');
const limits = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders);
  app.use(compression());
  app.use(cors({ origin: (origin, cb) => cb(null, config.isAllowedOrigin(origin)), credentials: false, maxAge: 600 }));
  if (config.env !== 'test') app.use(morgan(config.isProd ? 'combined' : 'dev'));

  // Health probes sit before rate limiting and parsing so orchestrators can always reach them.
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ ready });
  });

  // Course saves send the whole curriculum in one request, so this path gets a larger body limit.
  app.use('/api/instructor', express.json({ limit: '5mb' }));
  // Everything else is small. rawBody is kept because Paystack's webhook signature is computed over it.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(sanitize);

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store'); // routes that are safe to cache opt in explicitly
    next();
  });
  app.use('/api', limits.api);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/courses', require('./routes/courses'));
  app.use('/api/learning', require('./routes/learning'));
  app.use('/api/instructor', require('./routes/instructor'));
  app.use('/api/live', require('./routes/live'));
  app.use('/api/payments', require('./routes/payments'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api', notFound);

  if (config.serveClient) mountClient(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Serves the built React app: hashed assets are cached for a year, HTML and the service worker never are. */
function mountClient(app) {
  const dist = config.clientDist;
  const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  // The playground page declares itself so the client can detect it was loaded under the matching CSP profile.
  const playgroundHtml = indexHtml.replace('</head>', '<meta name="piq-profile" content="playground" /></head>');

  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    })
  );

  // Single-page app: any other page request gets the HTML shell and the router takes over.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(isPlayground(req.path) ? playgroundHtml : indexHtml);
  });
}

module.exports = { createApp };

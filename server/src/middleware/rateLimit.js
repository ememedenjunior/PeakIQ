const rateLimit = require('express-rate-limit');

// In-memory counters: correct for one API instance. For several instances, give express-rate-limit a shared store (e.g. Redis).
const make = (options) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please wait a moment and try again.' },
    ...options,
  });

const MIN = 60 * 1000;

module.exports = {
  // Everything under /api
  api: make({ windowMs: 15 * MIN, limit: 800 }),
  // Failed logins only: a successful login does not use up the allowance
  login: make({ windowMs: 15 * MIN, limit: 10, skipSuccessfulRequests: true }),
  register: make({ windowMs: 60 * MIN, limit: 15 }),
  payments: make({ windowMs: 60 * MIN, limit: 30 }),
  quiz: make({ windowMs: 10 * MIN, limit: 60 }),
  live: make({ windowMs: 60 * MIN, limit: 40 }),
  writes: make({ windowMs: 10 * MIN, limit: 300 }),
};

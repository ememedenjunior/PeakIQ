// Stops NoSQL operator injection ({ "email": { "$gt": "" } }) and prototype pollution by removing
// dangerous keys from every part of the request before any route sees it.
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function strip(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 25) return;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.') || BAD_KEYS.has(key)) {
      delete value[key];
    } else {
      strip(value[key], depth + 1);
    }
  }
}

function sanitize(req, _res, next) {
  strip(req.body);
  strip(req.query);
  strip(req.params);
  next();
}

module.exports = sanitize;
module.exports.strip = strip;

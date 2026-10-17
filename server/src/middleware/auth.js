const User = require('../models/User');
const { verifyToken } = require('../lib/tokens');

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

/** Requires a valid token and attaches the user to req.user. */
async function protect(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  let id;
  try {
    id = verifyToken(token);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  const user = await User.findById(id);
  if (!user) return res.status(401).json({ message: 'User no longer exists' });
  req.user = user;
  next();
}

/** Like protect, but anonymous requests pass through (req.user stays undefined). */
async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();
  try {
    req.user = (await User.findById(verifyToken(token))) || undefined;
  } catch {
    /* an expired token on a public page should not block it */
  }
  next();
}

const isStaff = (user) => !!user && ['instructor', 'admin'].includes(user.role);

function instructorOnly(req, res, next) {
  if (isStaff(req.user)) return next();
  res.status(403).json({ message: 'Instructors only' });
}

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admins only' });
}

module.exports = { protect, optionalAuth, instructorOnly, adminOnly, isStaff };

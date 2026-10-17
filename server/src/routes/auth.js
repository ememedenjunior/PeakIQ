const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const notify = require('../lib/notify');
const { signToken } = require('../lib/tokens');
const { fail } = require('../lib/errors');
const { isEmail, cleanString } = require('../lib/validate');
const { protect } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

const router = express.Router();

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });

// Compared against when the email is unknown, so "no such user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

router.post('/register', limits.register, async (req, res) => {
  const name = cleanString(req.body.name, 80);
  const email = cleanString(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!name) throw fail(400, 'Enter your name.');
  if (!isEmail(email)) throw fail(400, 'Enter a valid email address.');
  if (password.length < 8) throw fail(400, 'Use a password of at least 8 characters.');
  if (password.length > 72) throw fail(400, 'Use a password of 72 characters or fewer.'); // bcrypt ignores anything past 72 bytes

  if (await User.exists({ email })) throw fail(409, 'That email is already registered. Try logging in.');

  // role is never taken from the request body
  const user = await User.create({ name, email, password });
  await notify(user._id, {
    type: 'system',
    title: 'Welcome to PeakIQ',
    message: 'Browse the courses to start learning at your own pace.',
    link: '/courses',
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', limits.login, async (req, res) => {
  const email = cleanString(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const user = isEmail(email) ? await User.findOne({ email }).select('+password') : null;
  const ok = user ? await user.matchPassword(password) : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
  if (!ok) throw fail(401, 'Invalid email or password.');

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', protect, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;

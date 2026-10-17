const express = require('express');
const Notification = require('../models/Notification');
const { isObjectId } = require('../lib/validate');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

router.get('/', async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ unread, items });
});

router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ ok: true });
});

router.post('/:id/read', async (req, res) => {
  if (isObjectId(req.params.id)) await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const Course = require('../models/Course');
const Payment = require('../models/Payment');
const Enrollment = require('../models/Enrollment');
const notify = require('../lib/notify');
const paystack = require('../lib/paystack');
const config = require('../config');
const { fail } = require('../lib/errors');
const { isObjectId } = require('../lib/validate');
const { protect } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

const router = express.Router();

const toKobo = (naira) => Math.round(naira * 100);

/** Does the gateway's record match exactly what we asked it to charge? */
const isExpectedCharge = (payment, data) =>
  !!data && data.status === 'success' && data.amount === toKobo(payment.amount) && (!data.currency || data.currency === 'NGN');

// Safe to run any number of times. Called for every successful payment, including repeats.
async function ensureEnrollment(payment) {
  await Enrollment.updateOne(
    { user: payment.user, course: payment.course },
    { $setOnInsert: { payment: payment._id } },
    { upsert: true }
  );
}

async function markSuccess(reference, raw) {
  // Atomic flip to success, so the notifications below are sent once even if the webhook and the browser race.
  const flipped = await Payment.findOneAndUpdate(
    { reference, status: { $ne: 'success' } },
    { status: 'success', paidAt: new Date(), raw },
    { new: true }
  );
  const payment = flipped || (await Payment.findOne({ reference, status: 'success' }));
  if (!payment) return null;

  // Always make sure the enrolment exists, even when the payment was already marked successful.
  // This heals the case where a crash happened after "paid" but before "enrolled".
  await ensureEnrollment(payment);

  if (flipped) {
    const course = await Course.findById(payment.course).select('title').lean();
    const title = course ? course.title : 'your course';
    await notify(payment.user, {
      type: 'payment',
      title: 'Payment successful',
      message: `You now have access to ${title}, including offline download.`,
      link: `/learn/${payment.course}`,
    });
    await notify(payment.user, {
      type: 'enrollment',
      title: 'Enrolled',
      message: `Welcome to ${title}. Start your first lesson.`,
      link: `/learn/${payment.course}`,
    });
  }
  return payment;
}

const failedNotice = (userId) =>
  notify(userId, {
    type: 'payment',
    title: 'Payment failed',
    message: 'Your payment did not go through. You can try again.',
    link: '/courses',
  });

// Start checkout
router.post('/initialize', protect, limits.payments, async (req, res) => {
  const courseId = req.body.courseId;
  if (!isObjectId(courseId)) throw fail(404, 'Course not found');
  const course = await Course.findById(courseId);
  if (!course || course.status !== 'published') throw fail(404, 'Course not found');

  if (await Enrollment.exists({ user: req.user._id, course: course._id })) {
    throw fail(409, 'You already own this course.');
  }

  // Free course: enrol straight away, there is nothing to charge
  if (course.price === 0) {
    await Enrollment.updateOne(
      { user: req.user._id, course: course._id },
      { $setOnInsert: { completedLessons: [] } },
      { upsert: true }
    );
    await notify(req.user._id, {
      type: 'enrollment',
      title: 'Enrolled',
      message: `Welcome to ${course.title}. Start your first lesson.`,
      link: `/learn/${course._id}`,
    });
    return res.json({ enrolled: true, courseId: course._id });
  }

  if (!paystack.isConfigured()) throw fail(503, 'Online payment is not available right now. Please try again later.');

  // Price always comes from the database, never from the client
  const reference = `PIQ_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const payment = await Payment.create({ user: req.user._id, course: course._id, reference, amount: course.price });

  try {
    const data = await paystack.initializeTransaction({
      email: req.user.email,
      amountNaira: course.price,
      reference,
      callbackUrl: `${config.clientUrl}/payment/callback`,
      metadata: { courseId: String(course._id), userId: String(req.user._id) },
    });
    res.json({ authorizationUrl: data.authorization_url, reference });
  } catch (err) {
    payment.status = 'failed';
    await payment.save();
    throw err;
  }
});

// Client lands here after Paystack redirects back
router.get('/verify/:reference', protect, async (req, res) => {
  const reference = String(req.params.reference).slice(0, 100);
  const payment = await Payment.findOne({ reference, user: req.user._id });
  if (!payment) throw fail(404, 'Payment not found');

  if (payment.status === 'success') {
    await ensureEnrollment(payment);
    return res.json({ status: 'success', courseId: payment.course });
  }

  const data = await paystack.verifyTransaction(payment.reference);
  if (isExpectedCharge(payment, data)) {
    await markSuccess(payment.reference, data);
    return res.json({ status: 'success', courseId: payment.course });
  }
  if (data.status === 'success') {
    // Paid, but not the amount we asked for. Never grant access; flag it for a human.
    console.error('[payments] amount mismatch', { reference, expected: toKobo(payment.amount), got: data.amount });
    return res.json({ status: 'failed' });
  }
  if (['failed', 'abandoned', 'reversed'].includes(data.status)) {
    if (payment.status === 'pending') {
      payment.status = 'failed';
      await payment.save();
      await failedNotice(payment.user);
    }
    return res.json({ status: 'failed' });
  }
  res.json({ status: payment.status }); // still pending
});

// Paystack webhook. Authenticated by its HMAC signature over the raw body (see app.js).
router.post('/webhook', async (req, res) => {
  if (!paystack.isValidWebhook(req.rawBody, req.headers['x-paystack-signature'])) {
    return res.sendStatus(401);
  }
  const { event, data } = req.body || {};
  const reference = data && typeof data.reference === 'string' ? data.reference : null;

  try {
    if (event === 'charge.success' && reference) {
      const payment = await Payment.findOne({ reference });
      if (payment && isExpectedCharge(payment, data)) await markSuccess(reference, data);
    } else if (event === 'charge.failed' && reference) {
      const payment = await Payment.findOneAndUpdate({ reference, status: 'pending' }, { status: 'failed' });
      if (payment) await failedNotice(payment.user);
    }
  } catch (err) {
    console.error('[payments] webhook error', err);
    return res.sendStatus(500); // Paystack retries on a non-200
  }
  res.sendStatus(200);
});

// Payment history
router.get('/', protect, async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).populate('course', 'title slug').sort({ createdAt: -1 }).limit(100).lean();
  res.json(payments);
});

module.exports = router;

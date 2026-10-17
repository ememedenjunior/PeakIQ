const crypto = require('crypto');
const config = require('../config');
const { fail } = require('./errors');

const BASE = 'https://api.paystack.co';
const TIMEOUT_MS = 15000;

const isConfigured = () => !!config.paystackSecret;

async function call(path, options = {}) {
  if (!isConfigured()) throw fail(503, 'Online payment is not available right now. Please try again later.');
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: AbortSignal.timeout(TIMEOUT_MS), // never let a slow gateway hang a request forever
      headers: {
        Authorization: `Bearer ${config.paystackSecret}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw fail(502, 'We could not reach the payment provider. Please try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.status) throw fail(502, body.message || 'The payment provider rejected the request.');
  return body.data;
}

// amountNaira -> kobo
function initializeTransaction({ email, amountNaira, reference, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: Math.round(amountNaira * 100),
      reference,
      callback_url: callbackUrl,
      currency: 'NGN',
      metadata,
    }),
  });
}

function verifyTransaction(reference) {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// Paystack signs the raw body with HMAC SHA512 using the secret key
function isValidWebhook(rawBody, signature) {
  if (!rawBody || !signature || !config.paystackSecret) return false;
  const hash = crypto.createHmac('sha512', config.paystackSecret).update(rawBody).digest('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, initializeTransaction, verifyTransaction, isValidWebhook };

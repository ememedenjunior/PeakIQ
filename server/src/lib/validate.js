const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const isObjectId = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v);

/** Trimmed string capped at `max`; anything that is not a string becomes ''. */
const cleanString = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = { isEmail, isObjectId, cleanString };

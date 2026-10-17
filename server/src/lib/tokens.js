const jwt = require('jsonwebtoken');
const config = require('../config');

// Pin the algorithm on both sign and verify so a forged "alg: none" token can never pass.
const ALGORITHM = 'HS256';

const signToken = (user) =>
  jwt.sign({ id: String(user._id || user.id) }, config.jwtSecret, { algorithm: ALGORITHM, expiresIn: config.jwtExpiresIn });

/** Returns the user id inside a valid token, or throws. */
const verifyToken = (token) => {
  const payload = jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM] });
  if (!payload || typeof payload.id !== 'string') throw new Error('Malformed token');
  return payload.id;
};

module.exports = { signToken, verifyToken };

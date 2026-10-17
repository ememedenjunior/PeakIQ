const crypto = require('crypto');
const config = require('../config');

/**
 * ICE servers handed to the browser for WebRTC.
 *
 * STUN lets most peers find a direct route. TURN relays media for peers behind strict NATs/firewalls
 * (common on campus and corporate networks), so a real deployment needs one.
 * With TURN_SECRET set we mint short-lived credentials per user (coturn `use-auth-secret`),
 * so the TURN server cannot be abused by someone who copies the credentials from the page.
 */
function buildIceServers(userId, { now = Date.now(), cfg = config.ice } = {}) {
  if (cfg.json) {
    try {
      const parsed = JSON.parse(cfg.json);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to the individual settings */
    }
  }

  const servers = [];
  if (cfg.stunUrls.length) servers.push({ urls: cfg.stunUrls });

  if (cfg.turnUrls.length) {
    if (cfg.turnSecret) {
      const expiry = Math.floor(now / 1000) + cfg.turnTtlSeconds;
      const username = `${expiry}:${userId}`;
      const credential = crypto.createHmac('sha1', cfg.turnSecret).update(username).digest('base64');
      servers.push({ urls: cfg.turnUrls, username, credential });
    } else if (cfg.turnUsername && cfg.turnCredential) {
      servers.push({ urls: cfg.turnUrls, username: cfg.turnUsername, credential: cfg.turnCredential });
    }
  }
  return servers;
}

module.exports = { buildIceServers };

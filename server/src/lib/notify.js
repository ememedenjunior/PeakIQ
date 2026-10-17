const Notification = require('../models/Notification');
const { emitToUser } = require('./socket');

// Persist a notification and push it to the user's live sockets
async function notify(userId, { type = 'system', title, message, link }) {
  const doc = await Notification.create({ user: userId, type, title, message, link });
  emitToUser(userId, 'notification', doc);
  return doc;
}

module.exports = notify;

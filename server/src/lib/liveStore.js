const mongoose = require('mongoose');
const { LiveSession, LiveAttendance } = require('../models/LiveSession');
const Enrollment = require('../models/Enrollment');
const Notification = require('../models/Notification');

// Plain-object view of a session, so the hub never touches Mongoose documents.
const toSession = (doc) =>
  doc && {
    id: String(doc._id),
    course: String(doc.course),
    host: String(doc.host),
    title: doc.title,
    status: doc.status,
    chatEnabled: doc.chatEnabled,
    peakViewers: doc.peakViewers || 0,
    removed: (doc.removed || []).map(String),
    startedAt: doc.startedAt,
  };

const liveStore = {
  async getSession(id) {
    return toSession(await LiveSession.findById(id).lean());
  },

  async isEnrolled(userId, courseId) {
    return !!(await Enrollment.exists({ user: userId, course: courseId }));
  },

  async listEnrolledUserIds(courseId) {
    const ids = await Enrollment.find({ course: courseId }).distinct('user');
    return ids.map(String);
  },

  async listLiveSessions() {
    return (await LiveSession.find({ status: 'live' }).lean()).map(toSession);
  },

  /** Atomically ends a session. Returns it, or null if it was not live (so ending twice is harmless). */
  async markEnded(id, { reason, peakViewers } = {}) {
    const update = { status: 'ended', endedAt: new Date(), endReason: reason };
    if (Number.isFinite(peakViewers)) update.peakViewers = peakViewers;
    return toSession(await LiveSession.findOneAndUpdate({ _id: id, status: 'live' }, { $set: update }, { new: true }).lean());
  },

  setChatEnabled: (id, enabled) => LiveSession.updateOne({ _id: id }, { chatEnabled: !!enabled }),
  addRemoved: (id, userId) => LiveSession.updateOne({ _id: id }, { $addToSet: { removed: userId } }),

  recordJoin: (sessionId, userId) =>
    LiveAttendance.updateOne(
      { session: sessionId, user: userId },
      { $setOnInsert: { firstJoinedAt: new Date() }, $inc: { joins: 1 } },
      { upsert: true }
    ),
  recordLeave: (sessionId, userId, seconds) =>
    LiveAttendance.updateOne({ session: sessionId, user: userId }, { $inc: { totalSeconds: seconds }, $set: { lastLeftAt: new Date() } }),

  /** One notification per enrolled student, written in a single round trip. */
  async createLiveNotifications(userIds, { title, message, link }) {
    if (!userIds.length) return [];
    const docs = userIds.map((user) => ({ user: new mongoose.Types.ObjectId(user), type: 'live', title, message, link }));
    return Notification.insertMany(docs, { ordered: false });
  },
};

module.exports = liveStore;

const mongoose = require('mongoose');

const { Schema } = mongoose;

const liveSessionSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ['live', 'ended'], default: 'live' },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    endReason: { type: String, enum: ['host_ended', 'host_left', 'max_duration', 'server'], default: undefined },
    chatEnabled: { type: Boolean, default: true },
    peakViewers: { type: Number, default: 0 },
    removed: [{ type: Schema.Types.ObjectId, ref: 'User' }], // learners the instructor removed; they cannot rejoin
  },
  { timestamps: true }
);

// The database itself guarantees at most one live session per course, even if two requests race.
liveSessionSchema.index({ course: 1 }, { unique: true, partialFilterExpression: { status: 'live' } });
liveSessionSchema.index({ course: 1, startedAt: -1 });
liveSessionSchema.index({ status: 1 });

const attendanceSchema = new Schema({
  session: { type: Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  firstJoinedAt: { type: Date, default: Date.now },
  lastLeftAt: Date,
  joins: { type: Number, default: 0 },
  totalSeconds: { type: Number, default: 0 },
});
attendanceSchema.index({ session: 1, user: 1 }, { unique: true });

module.exports = {
  LiveSession: mongoose.models.LiveSession || mongoose.model('LiveSession', liveSessionSchema),
  LiveAttendance: mongoose.models.LiveAttendance || mongoose.model('LiveAttendance', attendanceSchema),
};

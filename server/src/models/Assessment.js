const mongoose = require('mongoose');

const { Schema } = mongoose;
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model, required: true });

/* ---- End-of-lesson test (holds the answer key, so it is kept apart from Course) ---- */

const QuestionSchema = new Schema(
  {
    type: { type: String, enum: ['single', 'multiple'], default: 'single' },
    prompt: { type: String, default: '', maxlength: 1000 },
    options: [{ type: String, maxlength: 300 }],
    correct: [{ type: Number }], // indexes into options
    explanation: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

const quizSchema = new Schema(
  {
    course: ref('Course'),
    lessonId: { type: Schema.Types.ObjectId, required: true },
    passMark: { type: Number, default: 70, min: 0, max: 100 },
    questions: [QuestionSchema],
  },
  { timestamps: true }
);
quizSchema.index({ course: 1, lessonId: 1 }, { unique: true });

/* ---- A learner's attempt at a test ---- */

const attemptSchema = new Schema(
  {
    user: ref('User'),
    course: ref('Course'),
    lessonId: { type: Schema.Types.ObjectId, required: true },
    score: { type: Number, required: true }, // percent
    passed: { type: Boolean, required: true },
    answers: [[Number]],
  },
  { timestamps: true }
);
attemptSchema.index({ user: 1, course: 1, lessonId: 1, passed: 1 });

/* ---- A learner's answer to a practical task (one per learner per task, replaced on resubmit) ---- */

const submissionSchema = new Schema(
  {
    user: ref('User'),
    course: ref('Course'),
    lessonId: { type: Schema.Types.ObjectId, required: true },
    answer: { type: String, required: true, maxlength: 20000 },
    attempts: { type: Number, default: 0 },
    status: { type: String, enum: ['submitted', 'reviewed'], default: 'submitted' },
    grade: { type: Number, min: 0, max: 100, default: null },
    feedback: { type: String, default: '', maxlength: 5000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true }
);
submissionSchema.index({ user: 1, course: 1, lessonId: 1 }, { unique: true });
submissionSchema.index({ course: 1, status: 1, updatedAt: -1 });

module.exports = {
  LessonQuiz: mongoose.models.LessonQuiz || mongoose.model('LessonQuiz', quizSchema),
  QuizAttempt: mongoose.models.QuizAttempt || mongoose.model('QuizAttempt', attemptSchema),
  Submission: mongoose.models.Submission || mongoose.model('Submission', submissionSchema),
};

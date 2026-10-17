const mongoose = require('mongoose');

const { Schema } = mongoose;

// Practical task a learner completes after a lesson. Safe for learners to see.
const TaskSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 160, default: '' },
    instructions: { type: String, maxlength: 20000, default: '' }, // Markdown
    submissionType: { type: String, enum: ['text', 'code', 'link'], default: 'text' },
    language: { type: String, enum: ['python', 'sql', 'javascript', 'html', 'other'], default: 'python' },
    rubric: [{ type: String, maxlength: 300 }], // marking guide, one criterion each
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

// NOTE: quizzes are NOT stored here. They live in LessonQuiz (see Assessment.js)
// so answer keys can never leak through a normal course query.
const LessonSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  content: { type: String, default: '', maxlength: 100000 }, // Markdown
  videoUrl: { type: String, default: '', maxlength: 500 }, // direct https link to an mp4/webm file
  durationMins: { type: Number, default: 10, min: 0, max: 600 },
  isPreview: { type: Boolean, default: false },
  task: { type: TaskSchema, default: null },
});

const ModuleSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  lessons: [LessonSchema],
});

const CourseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    track: { type: String, trim: true, default: 'general' },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
    summary: { type: String, default: '', maxlength: 600 },
    outcomes: [{ type: String, maxlength: 200 }],
    price: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: Date, // once set, the course can no longer be deleted (learners may have enrolled)
    // Bumped on every content save. Learners' offline copies refresh when this changes.
    version: { type: Number, default: 1 },
    instructor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    modules: [ModuleSchema],
  },
  { timestamps: true }
);

CourseSchema.index({ status: 1, createdAt: 1 });
CourseSchema.index({ instructor: 1, updatedAt: -1 });

module.exports = mongoose.models.Course || mongoose.model('Course', CourseSchema);

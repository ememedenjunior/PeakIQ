const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    reference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // Naira
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    paidAt: Date,
    raw: { type: Object, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

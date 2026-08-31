const mongoose = require('mongoose');

/**
 * WeeklyBuffetPlan — allows hotel owners to submit an entire week's
 * buffet schedule in a single operation for admin review.
 *
 * Status:
 *   draft → submitted → approved / rejected / partial
 *   'partial' = some buffets approved, some rejected
 */
const weeklyBuffetPlanSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },

    // ─── Week Range ───────────────────────────────────────────────────────────
    weekStartDate: {
      type: Date,
      required: [true, 'Week start date is required'],
    },
    weekEndDate: {
      type: Date,
      required: [true, 'Week end date is required'],
    },
    weekLabel: {
      type: String,
      trim: true,
      // e.g., "Week of 1 Sep 2026"
    },

    // ─── Buffets in this plan ─────────────────────────────────────────────────
    buffets: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Buffet',
      },
    ],

    // ─── Status ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected', 'partial'],
      default: 'draft',
    },
    submittedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    adminNotes: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
weeklyBuffetPlanSchema.index({ hotel: 1, weekStartDate: 1 });
weeklyBuffetPlanSchema.index({ status: 1, createdAt: -1 });
weeklyBuffetPlanSchema.index({ owner: 1 });

module.exports = mongoose.model('WeeklyBuffetPlan', weeklyBuffetPlanSchema);

const mongoose = require('mongoose');

/**
 * BuffetReview — user review and rating for a completed buffet.
 *
 * isVerified = true if the user has a 'completed' reservation
 * for this buffet (verified diner).
 */
const buffetReviewSchema = new mongoose.Schema(
  {
    buffet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Buffet',
      required: [true, 'Buffet reference is required'],
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BuffetReservation',
      default: null,
    },

    // ─── Ratings ──────────────────────────────────────────────────────────────
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    foodQualityRating: { type: Number, min: 1, max: 5, default: null },
    valueRating: { type: Number, min: 1, max: 5, default: null },
    serviceRating: { type: Number, min: 1, max: 5, default: null },
    ambianceRating: { type: Number, min: 1, max: 5, default: null },

    // ─── Review Text ──────────────────────────────────────────────────────────
    review: {
      type: String,
      trim: true,
      maxlength: [2000, 'Review cannot exceed 2000 characters'],
    },

    // ─── Trust Signals ────────────────────────────────────────────────────────
    isVerified: { type: Boolean, default: false }, // user actually visited
    isVisible: { type: Boolean, default: true },
    isReported: { type: Boolean, default: false },

    // ─── Admin Moderation ─────────────────────────────────────────────────────
    adminNote: { type: String, default: null },
    hiddenReason: { type: String, default: null },

    // ─── Helpful votes ────────────────────────────────────────────────────────
    helpfulCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Compound index: one review per user per buffet ───────────────────────────
buffetReviewSchema.index({ buffet: 1, user: 1 }, { unique: true });
buffetReviewSchema.index({ hotel: 1, createdAt: -1 });
buffetReviewSchema.index({ rating: -1 });
buffetReviewSchema.index({ isVisible: 1, createdAt: -1 });

module.exports = mongoose.model('BuffetReview', buffetReviewSchema);

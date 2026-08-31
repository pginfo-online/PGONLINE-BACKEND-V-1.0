const mongoose = require('mongoose');

/**
 * BuffetPromotion — special offers/discounts for a buffet.
 *
 * Types:
 *   early_bird     — book early, get discount
 *   couple         — 2 people at reduced combined price
 *   family         — 4+ people at reduced price
 *   pginfo_exclusive — platform-exclusive offer
 *   group          — 6+ people
 *   custom         — any custom promotion
 */
const buffetPromotionSchema = new mongoose.Schema(
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
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },

    // ─── Promotion Details ────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['early_bird', 'couple', 'family', 'pginfo_exclusive', 'group', 'custom'],
      required: [true, 'Promotion type is required'],
    },
    title: {
      type: String,
      required: [true, 'Promotion title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },

    // ─── Discount ─────────────────────────────────────────────────────────────
    discountType: {
      type: String,
      enum: ['flat', 'percentage'],
      required: [true, 'Discount type is required'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [0, 'Discount cannot be negative'],
    },
    originalPrice: {
      type: Number,
      required: [true, 'Original price is required'],
      min: 0,
    },
    finalPrice: {
      type: Number,
      required: [true, 'Final price is required'],
      min: 0,
    },

    // ─── Party Size Constraints ───────────────────────────────────────────────
    minPartySize: {
      type: Number,
      default: 1,
      min: 1,
    },
    maxPartySize: {
      type: Number,
      default: null, // null = no limit
    },

    // ─── Validity ─────────────────────────────────────────────────────────────
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },

    // ─── Usage Limits ─────────────────────────────────────────────────────────
    maxRedemptions: { type: Number, default: null }, // null = unlimited
    redemptionCount: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
buffetPromotionSchema.index({ buffet: 1 });
buffetPromotionSchema.index({ hotel: 1 });
buffetPromotionSchema.index({ isActive: 1 });

// ─── Virtual: savingsAmount ───────────────────────────────────────────────────
buffetPromotionSchema.virtual('savingsAmount').get(function () {
  return this.originalPrice - this.finalPrice;
});

module.exports = mongoose.model('BuffetPromotion', buffetPromotionSchema);

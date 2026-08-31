const mongoose = require('mongoose');

/**
 * Buffet Model — core entity for individual buffet events.
 *
 * Lifecycle:
 *   draft → submitted → under_review → approved → scheduled → live → completed
 *   OR: rejected / cancelled / paused
 *
 * Key rules:
 *   - Nothing goes live without admin approval
 *   - expiresAt is auto-computed from date + endTime
 *   - Scheduler auto-transitions approved → live → completed
 *   - Expired buffets are excluded from all public discovery queries
 */

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    reason: { type: String, default: null },
  },
  { _id: false }
);

const buffetImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    isMain: { type: Boolean, default: false },
    caption: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const buffetSchema = new mongoose.Schema(
  {
    // ─── Ownership ────────────────────────────────────────────────────────────
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

    // ─── Basic Info ───────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Buffet name is required'],
      trim: true,
      maxlength: [200, 'Buffet name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },

    // ─── Type & Dietary ───────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['lunch', 'dinner', 'brunch', 'breakfast', 'special', 'family', 'festival', 'unlimited'],
      required: [true, 'Buffet type is required'],
    },
    foodType: {
      type: String,
      enum: ['veg', 'nonveg', 'both'],
      default: 'both',
    },

    // ─── Scheduling ───────────────────────────────────────────────────────────
    date: {
      type: Date,
      required: [true, 'Buffet date is required'],
    },
    startTime: {
      type: String, // 'HH:mm' format
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: String, // 'HH:mm' format
      required: [true, 'End time is required'],
    },
    expiresAt: {
      type: Date, // auto-computed: date + endTime
    },

    // ─── Pricing ──────────────────────────────────────────────────────────────
    pricePerPerson: {
      type: Number,
      required: [true, 'Price per person is required'],
      min: [0, 'Price cannot be negative'],
    },
    originalPrice: {
      type: Number, // set when promotion reduces price
      min: 0,
      default: null,
    },

    // ─── Capacity ─────────────────────────────────────────────────────────────
    maxCapacity: {
      type: Number,
      min: 0,
      default: null, // null = unlimited
    },
    reservedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Cuisine ──────────────────────────────────────────────────────────────
    cuisine: {
      type: [String],
      default: [],
    },

    // ─── Media ────────────────────────────────────────────────────────────────
    images: {
      type: [buffetImageSchema],
      default: [],
    },

    // ─── Lifecycle Status ─────────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'draft',
        'submitted',
        'under_review',
        'approved',
        'scheduled',
        'live',
        'completed',
        'rejected',
        'cancelled',
        'paused',
      ],
      default: 'draft',
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    rejectionReason: { type: String, default: null },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: { type: Date, default: null },

    // ─── Weekly Plan ──────────────────────────────────────────────────────────
    isWeeklyPlan: { type: Boolean, default: false },
    weeklyPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WeeklyBuffetPlan',
      default: null,
    },

    // ─── State ────────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },

    // ─── Location (denormalized for fast queries) ──────────────────────────────
    city: { type: String, trim: true },
    area: { type: String, trim: true },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    areaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Area' },

    // ─── Analytics ───────────────────────────────────────────────────────────
    views: { type: Number, default: 0 },
    reservations: { type: Number, default: 0 }, // denormalized count
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
buffetSchema.index({ hotel: 1, date: 1 });
buffetSchema.index({ city: 1, area: 1, date: 1 });
buffetSchema.index({ status: 1, isActive: 1 });
buffetSchema.index({ expiresAt: 1 });
buffetSchema.index({ date: 1 });
buffetSchema.index({ pricePerPerson: 1 });
buffetSchema.index({ owner: 1 });
buffetSchema.index({ status: 1, city: 1, date: 1, expiresAt: 1 }); // main discovery index

// ─── Virtual: isExpired ───────────────────────────────────────────────────────
buffetSchema.virtual('isExpired').get(function () {
  return this.expiresAt ? this.expiresAt < new Date() : false;
});

// ─── Virtual: availableCapacity ───────────────────────────────────────────────
buffetSchema.virtual('availableCapacity').get(function () {
  if (this.maxCapacity === null || this.maxCapacity === undefined) return null;
  return Math.max(0, this.maxCapacity - this.reservedCount);
});

// ─── Pre-save: compute expiresAt from date + endTime ─────────────────────────
buffetSchema.pre('save', function (next) {
  if ((this.isModified('date') || this.isModified('endTime')) && this.date && this.endTime) {
    try {
      const [hours, minutes] = this.endTime.split(':').map(Number);
      const d = new Date(this.date);
      d.setUTCHours(hours, minutes, 0, 0);
      // Add 30 min grace period so buffets don't expire exactly at endTime
      d.setMinutes(d.getMinutes() + 30);
      this.expiresAt = d;
    } catch (_) {
      // If parsing fails, don't block save
    }
  }
  next();
});

module.exports = mongoose.model('Buffet', buffetSchema);

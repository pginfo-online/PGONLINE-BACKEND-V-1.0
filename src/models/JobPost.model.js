const mongoose = require('mongoose');

/**
 * JobPost — a hiring post created by a PG owner.
 *
 * Job posts are visible publicly on the mobile app (Hiring tab).
 * Anyone can apply; applications are reviewed by the owner.
 */
const jobPostSchema = new mongoose.Schema(
  {
    pg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PG',
      required: [true, 'PG reference is required'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },
    // ─── Job Details ───────────────────────────────────────────────
    title: {
      type: String,
      required: [true, 'Job title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    role: {
      type: String,
      enum: ['cook', 'cleaner', 'security', 'manager', 'electrician', 'plumber', 'other'],
      required: [true, 'Role is required'],
    },
    customRole: { type: String, trim: true }, // when role === 'other'
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    requirements: {
      type: String,
      trim: true,
      maxlength: [1000, 'Requirements cannot exceed 1000 characters'],
    },
    // ─── Compensation ──────────────────────────────────────────────
    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    salaryFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'monthly',
    },
    // ─── Location ──────────────────────────────────────────────────
    city:    { type: String, trim: true },
    area:    { type: String, trim: true },
    address: { type: String, trim: true },
    // ─── Preferences ───────────────────────────────────────────────
    genderPreference: {
      type: String,
      enum: ['male', 'female', 'any'],
      default: 'any',
    },
    experienceRequired: { type: Number, min: 0, default: 0 }, // in years
    accommodation:      { type: Boolean, default: false }, // accommodation provided?
    food:               { type: Boolean, default: false },  // food provided?
    // ─── Timing ────────────────────────────────────────────────────
    workingHours: { type: String, trim: true },
    shiftType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract'],
      default: 'full_time',
    },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['open', 'closed', 'filled', 'draft'],
      default: 'open',
    },
    // ─── Analytics ─────────────────────────────────────────────────
    views:        { type: Number, default: 0 },
    applications: { type: Number, default: 0 },
    closedAt:     { type: Date, default: null },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
jobPostSchema.index({ status: 1, createdAt: -1 });
jobPostSchema.index({ pg: 1, status: 1 });
jobPostSchema.index({ owner: 1 });
jobPostSchema.index({ city: 1, role: 1, status: 1 });
jobPostSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('JobPost', jobPostSchema);

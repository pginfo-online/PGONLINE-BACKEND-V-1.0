const mongoose = require('mongoose');

/**
 * JobApplication — submitted by a candidate for a JobPost.
 *
 * Status lifecycle:
 *   pending → shortlisted → interview → hired
 *   pending → rejected
 *   shortlisted → rejected
 */
const jobApplicationSchema = new mongoose.Schema(
  {
    jobPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobPost',
      required: [true, 'JobPost reference is required'],
    },
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
    // Optional: if applicant has a PGInfo account
    applicantUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // ─── Applicant Details ─────────────────────────────────────────
    applicantName: {
      type: String,
      required: [true, 'Applicant name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
      default: null,
    },
    // ─── Application Content ───────────────────────────────────────
    experience: {
      type: Number,
      min: [0, 'Experience cannot be negative'],
      default: 0,
    }, // years
    coverLetter: {
      type: String,
      trim: true,
      maxlength: [2000, 'Cover letter cannot exceed 2000 characters'],
    },
    currentLocation: { type: String, trim: true },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'shortlisted', 'interview', 'hired', 'rejected'],
      default: 'pending',
    },
    // Owner's notes on the application
    ownerNotes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    rejectionReason: { type: String, trim: true, default: null },
    interviewDate:   { type: Date, default: null },
    hiredAt:         { type: Date, default: null },
    // ─── Staff Record (if hired) ───────────────────────────────────
    staffRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
jobApplicationSchema.index({ jobPost: 1, status: 1 });
jobApplicationSchema.index({ pg: 1, status: 1 });
jobApplicationSchema.index({ owner: 1, createdAt: -1 });
// Prevent duplicate applications per phone per job
jobApplicationSchema.index({ jobPost: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);

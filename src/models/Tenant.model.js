const mongoose = require('mongoose');

/**
 * Tenant — a person living in a PG bed.
 *
 * A Tenant may or may not have an associated User account.
 * - If the person already has a PGInfo account, link via `user`.
 * - If not, the owner can create a tenant record with just name/phone/email.
 *   When the person registers later, they can be linked.
 *
 * Tenant lifecycle:
 *   pending → active   (after bed assignment + verification)
 *   active  → notice   (when notice period starts)
 *   notice  → vacated  (after move-out)
 *   any     → inactive (manual deactivation)
 */
const emergencyContactSchema = new mongoose.Schema(
  {
    name:         { type: String, trim: true },
    relationship: { type: String, trim: true },
    relation:     { type: String, trim: true },
    phone:        { type: String, trim: true },
  },
  { _id: false }
);

const tenantSchema = new mongoose.Schema(
  {
    // Optional link to a PGInfo User account
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // ─── Property Hierarchy ───────────────────────────────────────
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
    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      default: null,
    },
    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Floor',
      default: null,
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      default: null,
    },
    bed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      default: null,
    },
    // ─── Personal Info ─────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Tenant name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number'],
    },
    profilePhoto: { type: String, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
    },
    dateOfBirth: { type: Date, default: null },
    // ─── ID Documents ──────────────────────────────────────────────
    aadhaar: { type: String, trim: true, default: null },
    documents: [
      {
        type:     { type: String, enum: ['aadhaar', 'pan', 'passport', 'driving_license', 'other'] },
        number:   { type: String, trim: true },
        fileUrl:  { type: String },
        verified: { type: Boolean, default: false },
      },
    ],
    // ─── Emergency Contact ─────────────────────────────────────────
    emergencyContact: emergencyContactSchema,
    // ─── Tenancy Details ───────────────────────────────────────────
    joinDate: {
      type: Date,
      required: [true, 'Join date is required'],
    },
    expectedLeaveDate: { type: Date, default: null },
    actualLeaveDate:   { type: Date, default: null },
    noticePeriodDays:  { type: Number, default: 30, min: 0 },
    // Monthly rent agreed at time of joining
    monthlyRent: {
      type: Number,
      required: [true, 'Monthly rent is required'],
      min: [0, 'Rent cannot be negative'],
    },
    // Security deposit collected
    securityDeposit: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositStatus: {
      type: String,
      enum: ['pending', 'received', 'refunded', 'partial'],
      default: 'pending',
    },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'active', 'notice', 'vacated', 'inactive'],
      default: 'pending',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    // ─── Food Preference ───────────────────────────────────────────
    foodPreference: {
      type: String,
      enum: ['veg', 'nonveg', 'eggetarian', 'none'],
      default: 'none',
    },
    // ─── Invitation / Onboarding ───────────────────────────────────
    invitationToken:     { type: String, default: null },
    invitationExpiresAt: { type: Date, default: null },
    isLinkedToUser:      { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtual Getters for Mobile Compatibility ─────────────────────────────────
tenantSchema.virtual('rentAmount').get(function () {
  return this.monthlyRent;
});
tenantSchema.virtual('joiningDate').get(function () {
  return this.joinDate;
});
tenantSchema.virtual('noticePeriod').get(function () {
  return this.noticePeriodDays;
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
tenantSchema.index({ pg: 1, status: 1 });
tenantSchema.index({ owner: 1, status: 1 });
tenantSchema.index({ user: 1 });
tenantSchema.index({ phone: 1, pg: 1 });
tenantSchema.index({ bed: 1 });
tenantSchema.index({ room: 1, status: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);

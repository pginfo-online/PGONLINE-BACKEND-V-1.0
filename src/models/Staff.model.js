const mongoose = require('mongoose');

/**
 * Staff — a person employed at a PG property.
 *
 * A Staff may optionally have a PGInfo User account.
 * RBAC permissions are stored per-staff-record for fine-grained control.
 */
const staffSchema = new mongoose.Schema(
  {
    // Optional link to a PGInfo User account
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
    // ─── Personal Info ─────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Staff name is required'],
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
    profilePhoto: { type: String, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
    },
    dateOfBirth: { type: Date, default: null },
    address:     { type: String, trim: true, default: null },
    aadhaar:     { type: String, trim: true, default: null },
    // ─── Employment ────────────────────────────────────────────────
    role: {
      type: String,
      enum: [
        'manager', 'property_manager', 'security', 'cleaner',
        'cook', 'electrician', 'plumber', 'gardener', 'driver', 'other',
      ],
      required: [true, 'Staff role is required'],
    },
    customRole: { type: String, trim: true }, // when role === 'other'
    joiningDate: {
      type: Date,
      required: [true, 'Joining date is required'],
    },
    leavingDate: { type: Date, default: null },
    salary: {
      type: Number,
      min: [0, 'Salary cannot be negative'],
      default: 0,
    },
    salaryFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'monthly',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'on_leave', 'terminated'],
      default: 'active',
    },
    // ─── RBAC Permissions ──────────────────────────────────────────
    // Explicitly grant capabilities beyond the base role
    permissions: {
      canManageTenants:   { type: Boolean, default: false },
      canCollectRent:     { type: Boolean, default: false },
      canManageRooms:     { type: Boolean, default: false },
      canViewReports:     { type: Boolean, default: false },
      canManageStaff:     { type: Boolean, default: false },
      canManageComplaints:{ type: Boolean, default: false },
      canHandleMaintenance:{ type: Boolean, default: false },
    },
    // ─── Documents ─────────────────────────────────────────────────
    documents: [
      {
        type:    { type: String, enum: ['aadhaar', 'pan', 'police_verification', 'offer_letter', 'other'] },
        fileUrl: { type: String },
      },
    ],
    // ─── Sourcing ──────────────────────────────────────────────────
    // If hired via the marketplace
    jobApplication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobApplication',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
staffSchema.index({ pg: 1, status: 1 });
staffSchema.index({ owner: 1, status: 1 });
staffSchema.index({ user: 1 });
staffSchema.index({ pg: 1, role: 1 });

module.exports = mongoose.model('Staff', staffSchema);

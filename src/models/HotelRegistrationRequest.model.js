const mongoose = require('mongoose');

/**
 * HotelRegistrationRequest — submitted by users (via mobile app) who want to
 * register their hotel and become a partner.
 *
 * Status flow:
 *   pending → under_review → approved / rejected
 *
 * On approval:
 *   - Admin creates Hotel document
 *   - Admin sets isHotelOwner: true on the User
 *   - App push notification + email with web panel credentials is sent
 */
const hotelRegistrationRequestSchema = new mongoose.Schema(
  {
    // ─── Applicant ───────────────────────────────────────────────────────────
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },

    // ─── Submitted Details ────────────────────────────────────────────────────
    ownerName: {
      type: String,
      required: [true, 'Owner name is required'],
      trim: true,
      maxlength: [100, 'Owner name cannot exceed 100 characters'],
    },
    mobileNumber: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
    },
    hotelName: {
      type: String,
      required: [true, 'Hotel name is required'],
      trim: true,
      maxlength: [200, 'Hotel name cannot exceed 200 characters'],
    },

    // ─── Location ─────────────────────────────────────────────────────────────
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    areaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
    },
    area: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    latitude: { type: Number },
    longitude: { type: Number },

    // ─── Status ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },

    // ─── Admin Review ─────────────────────────────────────────────────────────
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    adminNotes: { type: String, default: null },

    // ─── Post-Approval ────────────────────────────────────────────────────────
    createdHotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      default: null,
    },
    credentialsSentAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
hotelRegistrationRequestSchema.index({ user: 1 });
hotelRegistrationRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('HotelRegistrationRequest', hotelRegistrationRequestSchema);

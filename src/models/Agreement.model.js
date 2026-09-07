const mongoose = require('mongoose');

/**
 * Agreement — digital rental agreement between Owner and Tenant.
 *
 * Status flow:
 *   draft → active       (when both parties agree / owner activates)
 *   active → expired     (when end date passes)
 *   active → terminated  (early termination)
 *   active → renewed     (on renewal — old agreement expires, new created)
 */
const agreementSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant reference is required'],
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
    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
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
    // ─── Agreement Number ──────────────────────────────────────────
    agreementNumber: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    // ─── Duration ──────────────────────────────────────────────────
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    // ─── Financial Terms ───────────────────────────────────────────
    monthlyRent: {
      type: Number,
      required: [true, 'Monthly rent is required'],
      min: 0,
    },
    securityDeposit: { type: Number, default: 0, min: 0 },
    noticePeriodDays: { type: Number, default: 30, min: 0 },
    // Rent due on which day of the month
    rentDueDay: { type: Number, default: 1, min: 1, max: 28 },
    // ─── Terms ─────────────────────────────────────────────────────
    // Free-text terms added by owner
    terms: {
      type: String,
      trim: true,
      maxlength: [5000, 'Terms cannot exceed 5000 characters'],
    },
    // Structured rules
    rules: {
      guestPolicy:    { type: String, trim: true },
      foodPolicy:     { type: String, trim: true },
      smokingAllowed: { type: Boolean, default: false },
      petsAllowed:    { type: Boolean, default: false },
      other:          { type: String, trim: true },
    },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'active', 'expired', 'terminated', 'renewed'],
      default: 'draft',
    },
    terminationReason: { type: String, trim: true, default: null },
    terminatedAt:      { type: Date, default: null },
    // ─── Document ──────────────────────────────────────────────────
    documentUrl:    { type: String, default: null }, // generated PDF URL
    documentPublicId: { type: String, default: null }, // Cloudinary public ID
    // ─── Signatures ────────────────────────────────────────────────
    signedByOwner: {
      signed:   { type: Boolean, default: false },
      signedAt: { type: Date, default: null },
    },
    signedByTenant: {
      signed:   { type: Boolean, default: false },
      signedAt: { type: Date, default: null },
    },
    // ─── Renewal ───────────────────────────────────────────────────
    renewedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agreement',
      default: null,
    },
    renewedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agreement',
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
agreementSchema.index({ tenant: 1, status: 1 });
agreementSchema.index({ pg: 1, status: 1 });
agreementSchema.index({ owner: 1, createdAt: -1 });
agreementSchema.index({ endDate: 1, status: 1 }); // for expiry jobs

module.exports = mongoose.model('Agreement', agreementSchema);

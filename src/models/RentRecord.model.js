const mongoose = require('mongoose');

/**
 * RentRecord — a single billing period's rent for a tenant.
 *
 * One record is generated per tenant per billing period (month).
 * Payments are tracked inside paymentHistory[].
 *
 * Status flow:
 *   pending → partial  (partial payment received)
 *   pending → paid     (full payment received)
 *   pending → overdue  (due date passed without full payment)
 *   partial → paid     (remaining amount paid)
 *   any     → waived   (manually waived by owner)
 */
const paymentEntrySchema = new mongoose.Schema(
  {
    amount:    { type: Number, required: true, min: 0 },
    paidAt:    { type: Date, default: Date.now },
    method:    { type: String, enum: ['online', 'cash', 'upi', 'bank_transfer', 'cheque', 'other'] },
    reference: { type: String, trim: true }, // Razorpay payment ID or manual ref
    notes:     { type: String, trim: true },
  },
  { _id: true }
);

const rentRecordSchema = new mongoose.Schema(
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
    // ─── Billing Period ────────────────────────────────────────────
    billingMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    billingYear: {
      type: Number,
      required: true,
      min: 2020,
    },
    // ─── Amounts ───────────────────────────────────────────────────
    rentAmount: {
      type: Number,
      required: [true, 'Rent amount is required'],
      min: [0, 'Rent cannot be negative'],
    },
    lateFee:    { type: Number, default: 0, min: 0 },
    discount:   { type: Number, default: 0, min: 0 },
    // Additional charges (electricity, food, etc.)
    additionalCharges: [
      {
        description: { type: String, trim: true },
        amount:      { type: Number, min: 0 },
      },
    ],
    // Total amount due = rentAmount + lateFee - discount + sum(additionalCharges)
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // ─── Dates ─────────────────────────────────────────────────────
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue', 'waived'],
      default: 'pending',
    },
    // ─── Payment History ───────────────────────────────────────────
    paymentHistory: [paymentEntrySchema],
    // ─── Invoice ───────────────────────────────────────────────────
    invoiceUrl:    { type: String, default: null },
    invoiceNumber: { type: String, default: null },
    // ─── Notes ─────────────────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    // Mark if late fee has been applied
    lateFeeApplied: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtual: outstanding amount ──────────────────────────────────────────────
rentRecordSchema.virtual('outstandingAmount').get(function () {
  return Math.max(0, this.totalAmount - this.paidAmount);
});

// ─── Compound index: unique record per tenant per billing period ───────────────
rentRecordSchema.index(
  { tenant: 1, billingMonth: 1, billingYear: 1 },
  { unique: true }
);
rentRecordSchema.index({ pg: 1, status: 1, dueDate: 1 });
rentRecordSchema.index({ owner: 1, billingYear: 1, billingMonth: 1 });
rentRecordSchema.index({ tenant: 1, status: 1 });

module.exports = mongoose.model('RentRecord', rentRecordSchema);

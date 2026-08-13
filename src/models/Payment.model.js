const mongoose = require('mongoose');

/**
 * Payment — records a Razorpay transaction (or manual cash/UPI payment).
 *
 * Security principles enforced by architecture:
 * - Orders are ALWAYS created server-side (never trust client amount)
 * - Signatures are ALWAYS verified server-side
 * - Idempotency key prevents duplicate processing
 * - Webhook events are also verified and idempotently handled
 */
const paymentSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
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
    // Optional: linked rent record
    rentRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RentRecord',
      default: null,
    },
    // ─── Payment Type ──────────────────────────────────────────────
    type: {
      type: String,
      enum: ['rent', 'security_deposit', 'maintenance', 'food', 'penalty', 'other'],
      required: [true, 'Payment type is required'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    // ─── Razorpay Fields ───────────────────────────────────────────
    razorpayOrderId:   { type: String, default: null, trim: true },
    razorpayPaymentId: { type: String, default: null, trim: true },
    razorpaySignature: { type: String, default: null, trim: true },
    // ─── Amount ────────────────────────────────────────────────────
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least ₹1'],
    },
    currency: {
      type: String,
      default: 'INR',
    },
    // ─── Status ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded', 'cancelled'],
      default: 'created',
    },
    // ─── Method (for manual payments) ─────────────────────────────
    method: {
      type: String,
      enum: ['razorpay', 'cash', 'upi', 'bank_transfer', 'cheque', 'other'],
      default: 'razorpay',
    },
    // ─── Idempotency ───────────────────────────────────────────────
    // Prevents double-processing of duplicate webhooks
    idempotencyKey: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    // ─── Webhook ───────────────────────────────────────────────────
    webhookProcessed:   { type: Boolean, default: false },
    webhookProcessedAt: { type: Date, default: null },
    // ─── Refund Info ───────────────────────────────────────────────
    refundId:     { type: String, default: null },
    refundAmount: { type: Number, default: 0 },
    refundedAt:   { type: Date, default: null },
    // ─── Audit ─────────────────────────────────────────────────────
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    paidAt: { type: Date, default: null },
    // Raw webhook/gateway response for audit
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false, // not sent in normal queries
    },
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
paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ tenant: 1, status: 1 });
paymentSchema.index({ pg: 1, status: 1 });
paymentSchema.index({ owner: 1, createdAt: -1 });
paymentSchema.index({ rentRecord: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

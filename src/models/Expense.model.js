const mongoose = require('mongoose');

/**
 * Expense — tracks operating costs for a PG property.
 *
 * Feeds into Financial Management: P&L, monthly reports.
 */
const expenseSchema = new mongoose.Schema(
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
    // ─── Category ──────────────────────────────────────────────────
    category: {
      type: String,
      enum: [
        'maintenance', 'utilities', 'staff_salary', 'food', 'cleaning',
        'security', 'internet', 'rent', 'furniture', 'equipment',
        'taxes', 'insurance', 'marketing', 'other',
      ],
      required: [true, 'Category is required'],
    },
    subcategory: { type: String, trim: true },
    // ─── Details ───────────────────────────────────────────────────
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    expenseDate: {
      type: Date,
      required: [true, 'Expense date is required'],
    },
    // ─── Vendor / Payee ────────────────────────────────────────────
    vendor:      { type: String, trim: true },
    vendorPhone: { type: String, trim: true },
    // ─── Payment Info ──────────────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'],
      default: 'cash',
    },
    referenceNumber: { type: String, trim: true },
    // ─── Receipt ───────────────────────────────────────────────────
    receiptUrl:      { type: String, default: null },
    receiptPublicId: { type: String, default: null },
    // ─── Recurring ─────────────────────────────────────────────────
    isRecurring: { type: Boolean, default: false },
    recurringFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
      default: null,
    },
    // ─── Staff link (e.g. salary expense) ─────────────────────────
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    // ─── Approval ──────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved', // owner's own expenses are auto-approved
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
expenseSchema.index({ pg: 1, expenseDate: -1 });
expenseSchema.index({ owner: 1, expenseDate: -1 });
expenseSchema.index({ pg: 1, category: 1 });
// For monthly P&L aggregation
expenseSchema.index({ pg: 1, expenseDate: 1, status: 1 });

module.exports = mongoose.model('Expense', expenseSchema);

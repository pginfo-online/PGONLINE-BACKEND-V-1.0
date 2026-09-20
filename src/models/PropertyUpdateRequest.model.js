const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ['submitted', 'approved', 'rejected', 'correction_required', 'cancelled', 're_submitted'],
    },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    comment: { type: String, trim: true },
  },
  { _id: false }
);

const propertyUpdateRequestSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['pg', 'residential_rental', 'commercial'],
      required: true,
      default: 'pg',
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    proposedChanges: { type: mongoose.Schema.Types.Mixed, required: true },
    originalSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'correction_required', 'cancelled'],
      default: 'pending',
      index: true,
    },
    adminComment: { type: String, default: null },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    auditLog: [auditLogSchema],
  },
  { timestamps: true }
);

// Backward-compatible virtual: `pg` alias for `property`
propertyUpdateRequestSchema.virtual('pg').get(function () {
  return this.property;
}).set(function (val) {
  this.property = val;
});

propertyUpdateRequestSchema.index({ property: 1, status: 1 });
propertyUpdateRequestSchema.index({ owner: 1, status: 1 });
propertyUpdateRequestSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model('PropertyUpdateRequest', propertyUpdateRequestSchema);

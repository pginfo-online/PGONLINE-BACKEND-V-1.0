const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true }, // 'submitted' | 'approved' | 'rejected' | 'correction_required' | 'cancelled'
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
  comment: { type: String },
}, { _id: false });

const pgUpdateRequestSchema = new mongoose.Schema(
  {
    pg: { type: mongoose.Schema.Types.ObjectId, ref: 'PG', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    proposedChanges: { type: mongoose.Schema.Types.Mixed, required: true },
    originalSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'correction_required', 'cancelled'],
      default: 'pending',
    },
    adminComment: { type: String, default: null },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    auditLog: [auditLogSchema],
  },
  { timestamps: true }
);

pgUpdateRequestSchema.index({ pg: 1, status: 1 });
pgUpdateRequestSchema.index({ owner: 1 });
pgUpdateRequestSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model('PGUpdateRequest', pgUpdateRequestSchema);

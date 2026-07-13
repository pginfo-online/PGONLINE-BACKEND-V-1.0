const mongoose = require('mongoose');

const appVersionAuditSchema = new mongoose.Schema(
  {
    versionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AppVersion',
      required: true,
    },
    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'toggle_active'],
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

appVersionAuditSchema.index({ versionId: 1 });
appVersionAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AppVersionAudit', appVersionAuditSchema);

const mongoose = require('mongoose');

const visitRequestSchema = new mongoose.Schema(
  {
    pg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PG',
      required: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
    },
    scheduledTime: {
      type: String, // e.g. "10:30 AM"
      required: [true, 'Scheduled time is required'],
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },
    ownerNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

visitRequestSchema.index({ tenant: 1 });
visitRequestSchema.index({ owner: 1 });
visitRequestSchema.index({ pg: 1 });
visitRequestSchema.index({ status: 1 });

module.exports = mongoose.model('VisitRequest', visitRequestSchema);

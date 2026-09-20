const mongoose = require('mongoose');

const visitRequestSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      index: true,
    },
    // Legacy field preserved for backward compatibility
    pg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PG',
      index: true,
    },
    category: {
      type: String,
      enum: ['pg', 'residential_rental', 'commercial'],
      default: 'pg',
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

// Auto-sync property and pg fields
visitRequestSchema.pre('save', function (next) {
  if (!this.property && this.pg) {
    this.property = this.pg;
  }
  if (!this.pg && this.property) {
    this.pg = this.property;
  }
  next();
});

visitRequestSchema.index({ tenant: 1 });
visitRequestSchema.index({ owner: 1 });
visitRequestSchema.index({ property: 1 });
visitRequestSchema.index({ pg: 1 });
visitRequestSchema.index({ status: 1 });

module.exports = mongoose.model('VisitRequest', visitRequestSchema);

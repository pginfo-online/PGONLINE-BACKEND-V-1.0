const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['inquiry', 'wishlist'],
      default: 'inquiry',
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Auto-sync property and pg fields before saving
leadSchema.pre('save', function (next) {
  if (!this.property && this.pg) {
    this.property = this.pg;
  }
  if (!this.pg && this.property) {
    this.pg = this.property;
  }
  next();
});

// Prevent duplicate wishlist entries
leadSchema.index({ property: 1, tenant: 1, type: 1 }, { unique: true, sparse: true });
leadSchema.index({ pg: 1, tenant: 1, type: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Lead', leadSchema);

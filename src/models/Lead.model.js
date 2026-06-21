const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
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

// Prevent duplicate wishlist entries
leadSchema.index({ pg: 1, tenant: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Lead', leadSchema);

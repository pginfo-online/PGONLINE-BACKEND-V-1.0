const mongoose = require('mongoose');

const exportJobSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    fileUrl: {
      type: String,
    },
    fileSize: {
      type: Number, // in bytes
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      type: String,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Add index on admin and status for performance
exportJobSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model('ExportJob', exportJobSchema);

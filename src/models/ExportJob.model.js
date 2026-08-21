const mongoose = require('mongoose');

const exportJobSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Optional for automatic server-scheduled jobs
    },
    jobType: {
      type: String,
      enum: ['manual_direct', 'manual_background', 'daily_9am_schedule'],
      default: 'manual_background',
    },
    dataset: {
      type: String,
      enum: ['pgs', 'users', 'leads', 'rent', 'all'],
      default: 'pgs',
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

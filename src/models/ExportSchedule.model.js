const mongoose = require('mongoose');

const exportScheduleSchema = new mongoose.Schema(
  {
    isDaily9AMEnabled: {
      type: Boolean,
      default: true,
    },
    cronExpression: {
      type: String,
      default: '0 9 * * *', // Daily at 9:00 AM IST
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    dataset: {
      type: String,
      enum: ['pgs', 'users', 'leads', 'rent', 'all'],
      default: 'pgs',
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: { status: 'approved' },
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    lastJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExportJob',
      default: null,
    },
    lastRunStatus: {
      type: String,
      enum: ['idle', 'running', 'completed', 'failed'],
      default: 'idle',
    },
    lastRunError: {
      type: String,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Singleton helper to get or create the schedule config
exportScheduleSchema.statics.getOrCreateSchedule = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      isDaily9AMEnabled: true,
      dataset: 'pgs',
      filters: { status: 'approved' },
    });
  }
  return config;
};

module.exports = mongoose.model('ExportSchedule', exportScheduleSchema);

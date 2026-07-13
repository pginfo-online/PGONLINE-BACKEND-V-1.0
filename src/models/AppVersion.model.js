const mongoose = require('mongoose');

const appVersionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['android', 'ios'],
      required: [true, 'Platform is required'],
    },
    version: {
      type: String,
      required: [true, 'Version string is required'],
      trim: true,
    },
    versionCode: {
      type: Number,
      default: 0,
    },
    updateLink: {
      type: String,
      required: [true, 'Update link is required'],
      trim: true,
      default: 'https://play.google.com/store/apps/details?id=com.pginfo.onlinee&pcampaignid=web_share',
    },
    minVersion: {
      type: String,
      required: [true, 'Minimum supported version is required'],
      trim: true,
    },
    priority: {
      type: String,
      enum: ['optional', 'recommended', 'important', 'critical'],
      required: [true, 'Update priority is required'],
    },
    title: {
      type: String,
      required: [true, 'Update title is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Update description is required'],
      trim: true,
    },
    releaseNotes: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      trim: true,
      default: 'App is currently undergoing scheduled maintenance. Please check back later.',
    },
    rolloutPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    scheduledRelease: {
      type: Date,
      default: null,
    },
    releaseDate: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

appVersionSchema.index({ platform: 1, version: -1 });
appVersionSchema.index({ platform: 1, isActive: 1 });

module.exports = mongoose.model('AppVersion', appVersionSchema);

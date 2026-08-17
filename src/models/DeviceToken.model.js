const mongoose = require('mongoose');

/**
 * DeviceToken — registers an Expo push token for a specific device/user pair.
 *
 * A single user may have multiple active devices (phone + tablet, etc.).
 * Tokens are marked inactive when:
 *   - The user logs out
 *   - Expo reports DeviceNotRegistered error
 *   - A new token replaces the old one on the same device
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },

    // The Expo push token (ExponentPushToken[...])
    token: {
      type: String,
      required: [true, 'Push token is required'],
      trim: true,
    },

    // Platform for analytics / APNs vs FCM routing decisions
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      default: 'android',
    },

    // Human-readable device name (from expo-device, optional)
    deviceName: {
      type: String,
      trim: true,
      default: null,
    },

    // App version at time of registration
    appVersion: {
      type: String,
      trim: true,
      default: null,
    },

    // Set false when: logout, DeviceNotRegistered error from Expo
    isActive: {
      type: Boolean,
      default: true,
    },

    // Updated on every successful send to this token
    lastUsedAt: {
      type: Date,
      default: null,
    },

    // The reason this token was deactivated (for debugging)
    deactivatedReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Unique token per platform (Expo tokens are globally unique, but enforce it)
deviceTokenSchema.index({ token: 1 }, { unique: true, sparse: true });
// Fetch all active tokens for a user quickly
deviceTokenSchema.index({ user: 1, isActive: 1 });
// For cleanup jobs
deviceTokenSchema.index({ isActive: 1, lastUsedAt: 1 });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);

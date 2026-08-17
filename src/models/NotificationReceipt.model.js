const mongoose = require('mongoose');

/**
 * NotificationReceipt — per-recipient delivery tracking.
 *
 * One receipt is created per user per notification send.
 * It tracks the full lifecycle: dispatch → Expo ticket → Expo receipt → delivery/failure.
 *
 * Status flow:
 *   pending   → sent       (Expo accepted the push ticket)
 *   pending   → failed     (Expo returned error for this device)
 *   sent      → delivered  (Expo receipt confirms delivery)
 *   sent      → failed     (Expo receipt reports error)
 *   any       → opened     (user tapped — updated via mobile API call)
 */
const notificationReceiptSchema = new mongoose.Schema(
  {
    notification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      required: [true, 'Notification reference is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeviceToken',
      default: null,
    },

    // ─── Expo Ticket (returned immediately after send) ─────────────────────────
    expoPushTicketId: {
      type: String,
      default: null,
      trim: true,
    },

    // ─── Expo Receipt (fetched async from Expo receipt endpoint) ───────────────
    expoReceiptId: {
      type: String,
      default: null,
      trim: true,
    },

    // ─── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed', 'opened'],
      default: 'pending',
    },

    // Error details when status = 'failed'
    errorCode: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },

    // ─── Timestamps ────────────────────────────────────────────────────────────
    sentAt:      { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    openedAt:    { type: Date, default: null },

    // ─── Retry ─────────────────────────────────────────────────────────────────
    retryCount:  { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
notificationReceiptSchema.index({ notification: 1, user: 1 });
notificationReceiptSchema.index({ user: 1, status: 1, createdAt: -1 });
notificationReceiptSchema.index({ expoPushTicketId: 1 }, { sparse: true }); // receipt polling
notificationReceiptSchema.index({ status: 1, nextRetryAt: 1 });             // retry job
notificationReceiptSchema.index({ notification: 1, status: 1 });            // stats aggregation

module.exports = mongoose.model('NotificationReceipt', notificationReceiptSchema);

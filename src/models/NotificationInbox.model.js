const mongoose = require('mongoose');

/**
 * NotificationInbox — per-user inbox item.
 *
 * Denormalizes key notification fields for fast offline-capable inbox rendering.
 * Supports read/unread state and soft delete.
 *
 * One NotificationInbox item is created per (user, notification) pair when
 * the notification is dispatched.
 */
const notificationInboxSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    notification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      default: null, // null for system-local-only items
    },

    // ─── Denormalized Content (for fast rendering without population) ──────────
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: null,
    },

    // ─── Navigation Data ───────────────────────────────────────────────────────
    type: {
      type: String,
      default: 'GENERAL_ALERT',
    },
    data: {
      deepLink:   { type: String, default: null },
      entityType: { type: String, default: null },
      entityId:   { type: String, default: null },
    },

    // ─── State ─────────────────────────────────────────────────────────────────
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },

    // Soft delete — user dismissed from inbox
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
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
// Primary inbox query: user's non-deleted items newest first
notificationInboxSchema.index({ user: 1, isDeleted: 1, createdAt: -1 });
// Unread count query
notificationInboxSchema.index({ user: 1, isRead: 1, isDeleted: 1 });
// Mark all read
notificationInboxSchema.index({ user: 1, isRead: 1 });
// Link back to notification
notificationInboxSchema.index({ notification: 1 });

module.exports = mongoose.model('NotificationInbox', notificationInboxSchema);

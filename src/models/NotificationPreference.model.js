const mongoose = require('mongoose');

/**
 * NotificationPreference — per-user notification opt-in/out settings.
 *
 * Created with all defaults = true on first access.
 * Transactional notifications (payments, rent) cannot be disabled by users
 * and are enforced at the notification.service.js level.
 */
const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true,
    },

    // Master push toggle — if false, no push is sent to this user
    pushEnabled: {
      type: Boolean,
      default: true,
    },

    // ─── Category-level Opt-in/Out ─────────────────────────────────────────────
    categories: {
      // PG listing updates, approval/rejection, changes
      pg_updates: { type: Boolean, default: true },

      // Booking/visit updates
      booking_updates: { type: Boolean, default: true },

      // Payment confirmations, receipts
      payment_updates: { type: Boolean, default: true },

      // Rent due reminders (7d, 3d, 1d before)
      rent_reminders: { type: Boolean, default: true },

      // Complaint status updates
      complaints: { type: Boolean, default: true },

      // Maintenance requests and updates
      maintenance: { type: Boolean, default: true },

      // Task assignments and reminders
      tasks: { type: Boolean, default: true },

      // Job postings and application updates
      jobs: { type: Boolean, default: true },

      // Promotional notifications (new PGs, featured, offers)
      promotions: { type: Boolean, default: true },

      // Platform-wide announcements
      announcements: { type: Boolean, default: true },

      // General platform alerts
      general_alerts: { type: Boolean, default: true },

      // Buffet module categories
      buffet_updates: { type: Boolean, default: true },
      buffet_reservations: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);

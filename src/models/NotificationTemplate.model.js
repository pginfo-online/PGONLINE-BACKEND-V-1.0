const mongoose = require('mongoose');

/**
 * NotificationTemplate — reusable notification templates.
 *
 * Templates define title/body with {{variable}} placeholders.
 * Admin can select a template when creating a notification,
 * and the system interpolates variables at send time.
 *
 * Available variables by type are defined in notification.types.js.
 */
const notificationTemplateSchema = new mongoose.Schema(
  {
    // Unique display name for this template
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    // Associated notification type (for filtering in admin UI)
    type: {
      type: String,
      default: 'GENERAL_ALERT',
      trim: true,
    },

    // Title with {{variable}} placeholders
    // e.g. "Your rent for {{month}} is due on {{dueDate}}"
    titleTemplate: {
      type: String,
      required: [true, 'Title template is required'],
      trim: true,
      maxlength: [200, 'Title template cannot exceed 200 characters'],
    },

    // Body with {{variable}} placeholders
    bodyTemplate: {
      type: String,
      required: [true, 'Body template is required'],
      trim: true,
      maxlength: [1000, 'Body template cannot exceed 1000 characters'],
    },

    // Optional default image URL
    imageUrl: {
      type: String,
      default: null,
    },

    // Default data payload for this template
    defaultData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
notificationTemplateSchema.index({ type: 1, isActive: 1 });
notificationTemplateSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);

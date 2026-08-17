const mongoose = require('mongoose');

/**
 * Notification — master record for a single notification send event.
 *
 * One Notification document is created per send action (not per recipient).
 * Per-recipient tracking lives in NotificationReceipt.
 * Per-user inbox items live in NotificationInbox.
 *
 * Status flow:
 *   draft      → scheduled  (when scheduledAt is set)
 *   draft      → sending    (when sent immediately)
 *   scheduled  → sending    (when scheduler picks it up)
 *   sending    → sent       (after all messages dispatched)
 *   sending    → failed     (if dispatch completely fails)
 *   any        → cancelled  (admin cancels a scheduled notification)
 */

const audienceSchema = new mongoose.Schema(
  {
    // Determines which targeting fields are used
    type: {
      type: String,
      enum: ['all', 'role', 'specific', 'pg', 'city'],
      required: true,
    },
    targetRoles: {
      type: [String],
      enum: ['admin', 'owner', 'tenant', 'staff', 'property_manager'],
      default: [],
    },
    targetUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    targetPgId: { type: mongoose.Schema.Types.ObjectId, ref: 'PG', default: null },
    targetCity: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const notificationStatsSchema = new mongoose.Schema(
  {
    total:     { type: Number, default: 0 }, // total recipients
    sent:      { type: Number, default: 0 }, // tickets dispatched to Expo
    failed:    { type: Number, default: 0 }, // failed to dispatch
    delivered: { type: Number, default: 0 }, // confirmed delivered by Expo receipt
    opened:    { type: Number, default: 0 }, // user tapped the notification
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    // ─── Type ──────────────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: [
        // PG Alerts
        'PG_APPROVED', 'PG_REJECTED', 'PG_CHANGES_REQUIRED', 'PG_LIVE', 'PG_LISTING_PAUSED',
        // Tenant
        'TENANT_ADDED', 'TENANT_BED_ASSIGNED', 'TENANT_VACATED', 'TENANT_INVITE',
        // Payment
        'RENT_GENERATED', 'RENT_DUE_REMINDER_7D', 'RENT_DUE_REMINDER_3D', 'RENT_DUE_REMINDER_1D',
        'RENT_OVERDUE', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_RECEIPT',
        'MANUAL_PAYMENT_RECORDED', 'SECURITY_DEPOSIT_RECEIVED', 'SECURITY_DEPOSIT_REFUNDED',
        // Agreement
        'AGREEMENT_CREATED', 'AGREEMENT_EXPIRING_7D', 'AGREEMENT_EXPIRING_3D',
        'AGREEMENT_EXPIRED', 'AGREEMENT_RENEWED',
        // Jobs
        'JOB_POSTED', 'JOB_APPLICATION_RECEIVED', 'JOB_APPLICATION_STATUS',
        // Owner
        'NEW_LEAD', 'VISIT_BOOKED', 'VISIT_REMINDER', 'VISIT_CANCELLED',
        'STAFF_ADDED', 'STAFF_UPDATE', 'EXPENSE_ADDED',
        // Meetups
        'MEETUP_CREATED', 'MEETUP_REMINDER',
        // Promotional
        'PROMO_NEW_PG', 'PROMO_FEATURED_PG', 'PROMO_SPECIAL_OFFER', 'PLATFORM_ANNOUNCEMENT',
        // System
        'ACCOUNT_WELCOME', 'ROLE_UPGRADED', 'ADMIN_CUSTOM', 'GENERAL_ALERT',
      ],
      required: [true, 'Notification type is required'],
    },

    // ─── Content ───────────────────────────────────────────────────────────────
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    body: {
      type: String,
      required: [true, 'Body is required'],
      trim: true,
      maxlength: [1000, 'Body cannot exceed 1000 characters'],
    },
    imageUrl: {
      type: String,
      default: null,
    },

    // ─── Action / Deep Link Data ────────────────────────────────────────────────
    data: {
      deepLink:   { type: String, default: null },   // e.g. pginfo://pg/123
      entityType: { type: String, default: null },   // e.g. 'PG', 'Payment', 'Agreement'
      entityId:   { type: String, default: null },   // mongo ObjectId as string
      metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    // ─── Audience ──────────────────────────────────────────────────────────────
    audience: {
      type: audienceSchema,
      required: true,
    },

    // ─── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
      default: 'draft',
    },
    scheduledAt: { type: Date, default: null },
    sentAt:      { type: Date, default: null },

    // ─── Creator ───────────────────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = system-generated (trigger-based)
    },

    // ─── Stats ─────────────────────────────────────────────────────────────────
    stats: {
      type: notificationStatsSchema,
      default: () => ({}),
    },

    // ─── Flags ─────────────────────────────────────────────────────────────────
    // Transactional = cannot be opted out of (payments, rent, agreements)
    isTransactional: {
      type: Boolean,
      default: false,
    },

    // ─── Template Reference ────────────────────────────────────────────────────
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationTemplate',
      default: null,
    },

    // ─── Error Info (for failed sends) ─────────────────────────────────────────
    errorMessage: {
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
notificationSchema.index({ status: 1, scheduledAt: 1 });   // scheduler polling
notificationSchema.index({ createdBy: 1, createdAt: -1 }); // admin history
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ status: 1, createdAt: -1 });    // history filter

module.exports = mongoose.model('Notification', notificationSchema);

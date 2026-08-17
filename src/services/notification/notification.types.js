/**
 * notification.types.js
 *
 * Central registry for all notification types in PGInfo.
 * Defines: type constants, category mappings, preference keys,
 * default templates, and deep link patterns.
 */

// ─── Type Constants ────────────────────────────────────────────────────────────
const NOTIFICATION_TYPES = {
  // PG Alerts
  PG_APPROVED:           'PG_APPROVED',
  PG_REJECTED:           'PG_REJECTED',
  PG_CHANGES_REQUIRED:   'PG_CHANGES_REQUIRED',
  PG_LIVE:               'PG_LIVE',
  PG_LISTING_PAUSED:     'PG_LISTING_PAUSED',

  // Tenant
  TENANT_ADDED:          'TENANT_ADDED',
  TENANT_BED_ASSIGNED:   'TENANT_BED_ASSIGNED',
  TENANT_VACATED:        'TENANT_VACATED',
  TENANT_INVITE:         'TENANT_INVITE',

  // Payment
  RENT_GENERATED:            'RENT_GENERATED',
  RENT_DUE_REMINDER_7D:      'RENT_DUE_REMINDER_7D',
  RENT_DUE_REMINDER_3D:      'RENT_DUE_REMINDER_3D',
  RENT_DUE_REMINDER_1D:      'RENT_DUE_REMINDER_1D',
  RENT_OVERDUE:              'RENT_OVERDUE',
  PAYMENT_SUCCESS:           'PAYMENT_SUCCESS',
  PAYMENT_FAILED:            'PAYMENT_FAILED',
  PAYMENT_RECEIPT:           'PAYMENT_RECEIPT',
  MANUAL_PAYMENT_RECORDED:   'MANUAL_PAYMENT_RECORDED',
  SECURITY_DEPOSIT_RECEIVED: 'SECURITY_DEPOSIT_RECEIVED',
  SECURITY_DEPOSIT_REFUNDED: 'SECURITY_DEPOSIT_REFUNDED',

  // Agreement
  AGREEMENT_CREATED:     'AGREEMENT_CREATED',
  AGREEMENT_EXPIRING_7D: 'AGREEMENT_EXPIRING_7D',
  AGREEMENT_EXPIRING_3D: 'AGREEMENT_EXPIRING_3D',
  AGREEMENT_EXPIRED:     'AGREEMENT_EXPIRED',
  AGREEMENT_RENEWED:     'AGREEMENT_RENEWED',

  // Jobs
  JOB_POSTED:                 'JOB_POSTED',
  JOB_APPLICATION_RECEIVED:   'JOB_APPLICATION_RECEIVED',
  JOB_APPLICATION_STATUS:     'JOB_APPLICATION_STATUS',

  // Owner / Visits / Leads
  NEW_LEAD:              'NEW_LEAD',
  VISIT_BOOKED:          'VISIT_BOOKED',
  VISIT_REMINDER:        'VISIT_REMINDER',
  VISIT_CANCELLED:       'VISIT_CANCELLED',
  STAFF_ADDED:           'STAFF_ADDED',
  STAFF_UPDATE:          'STAFF_UPDATE',
  EXPENSE_ADDED:         'EXPENSE_ADDED',

  // Meetups
  MEETUP_CREATED:        'MEETUP_CREATED',
  MEETUP_REMINDER:       'MEETUP_REMINDER',

  // Promotional
  PROMO_NEW_PG:           'PROMO_NEW_PG',
  PROMO_FEATURED_PG:      'PROMO_FEATURED_PG',
  PROMO_SPECIAL_OFFER:    'PROMO_SPECIAL_OFFER',
  PLATFORM_ANNOUNCEMENT:  'PLATFORM_ANNOUNCEMENT',

  // System
  ACCOUNT_WELCOME: 'ACCOUNT_WELCOME',
  ROLE_UPGRADED:   'ROLE_UPGRADED',
  ADMIN_CUSTOM:    'ADMIN_CUSTOM',
  GENERAL_ALERT:   'GENERAL_ALERT',
};

// ─── Category Keys (match NotificationPreference.categories fields) ────────────
const CATEGORIES = {
  PG_UPDATES:      'pg_updates',
  BOOKING_UPDATES: 'booking_updates',
  PAYMENT_UPDATES: 'payment_updates',
  RENT_REMINDERS:  'rent_reminders',
  COMPLAINTS:      'complaints',
  MAINTENANCE:     'maintenance',
  TASKS:           'tasks',
  JOBS:            'jobs',
  PROMOTIONS:      'promotions',
  ANNOUNCEMENTS:   'announcements',
  GENERAL_ALERTS:  'general_alerts',
};

// ─── Category Labels (for mobile preferences UI) ───────────────────────────────
const CATEGORY_LABELS = {
  pg_updates:      { label: 'PG Updates', description: 'PG approval, rejection, listing status' },
  booking_updates: { label: 'Bookings & Visits', description: 'Visit confirmations, reminders, cancellations' },
  payment_updates: { label: 'Payments', description: 'Payment confirmations and receipts' },
  rent_reminders:  { label: 'Rent Reminders', description: 'Upcoming rent due and overdue alerts' },
  complaints:      { label: 'Complaints', description: 'Complaint status updates' },
  maintenance:     { label: 'Maintenance', description: 'Maintenance requests and updates' },
  tasks:           { label: 'Tasks', description: 'Task assignments and reminders' },
  jobs:            { label: 'Jobs', description: 'New job postings and application updates' },
  promotions:      { label: 'Promotions', description: 'New PGs, offers, and featured listings' },
  announcements:   { label: 'Announcements', description: 'Platform-wide news and updates' },
  general_alerts:  { label: 'General Alerts', description: 'Other important notifications' },
};

/**
 * TYPE_CONFIG — per-type configuration.
 * Keys:
 *   category:        Which preference category this belongs to
 *   preferenceKey:   The NotificationPreference.categories field name
 *   transactional:   If true, user cannot opt out (enforced in service)
 *   title:           Default title template (supports {{var}} interpolation)
 *   body:            Default body template
 *   deepLinkPattern: Pattern to build deep link ({{entityId}} replaced)
 *   entityType:      What entity this relates to
 *   icon:            Icon name for mobile UI
 */
const TYPE_CONFIG = {
  // ─── PG Alerts ──────────────────────────────────────────────────────────────
  PG_APPROVED: {
    category: 'PG Updates',
    preferenceKey: 'pg_updates',
    transactional: false,
    title: '🎉 PG Approved!',
    body: 'Your PG listing "{{pgName}}" has been approved and is now live on PGinfo.online!',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'checkmark-circle',
  },
  PG_REJECTED: {
    category: 'PG Updates',
    preferenceKey: 'pg_updates',
    transactional: true,
    title: '❌ PG Listing Rejected',
    body: 'Your PG listing "{{pgName}}" was rejected. Reason: {{reason}}',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'close-circle',
  },
  PG_CHANGES_REQUIRED: {
    category: 'PG Updates',
    preferenceKey: 'pg_updates',
    transactional: true,
    title: '📝 Changes Required',
    body: 'Your PG listing "{{pgName}}" needs some changes before approval.',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'create-outline',
  },
  PG_LIVE: {
    category: 'PG Updates',
    preferenceKey: 'pg_updates',
    transactional: false,
    title: '🏠 New PG Available in {{city}}',
    body: '"{{pgName}}" is now available in {{area}}, {{city}}. Check it out!',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'home',
  },
  PG_LISTING_PAUSED: {
    category: 'PG Updates',
    preferenceKey: 'pg_updates',
    transactional: false,
    title: '⏸ PG Listing Paused',
    body: 'Your PG listing "{{pgName}}" has been paused and is no longer visible.',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'pause-circle-outline',
  },

  // ─── Tenant ─────────────────────────────────────────────────────────────────
  TENANT_ADDED: {
    category: 'Tenant',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '🏡 Welcome to {{pgName}}!',
    body: 'You have been added as a tenant at {{pgName}}, {{city}}. Tap to view your details.',
    deepLinkPattern: 'pginfo://tenant-home',
    entityType: 'Tenant',
    icon: 'key',
  },
  TENANT_BED_ASSIGNED: {
    category: 'Tenant',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '🛏 Bed Assigned',
    body: 'You have been assigned {{bedLabel}} in Room {{roomNumber}} at {{pgName}}.',
    deepLinkPattern: 'pginfo://tenant-home',
    entityType: 'Tenant',
    icon: 'bed-outline',
  },
  TENANT_VACATED: {
    category: 'Tenant',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '📦 Tenant Vacated',
    body: '{{tenantName}} has vacated from {{pgName}}. Room is now available.',
    deepLinkPattern: 'pginfo://manage',
    entityType: 'PG',
    icon: 'exit-outline',
  },
  TENANT_INVITE: {
    category: 'Tenant',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '📩 Tenant Invitation',
    body: 'You have been invited to join {{pgName}} as a tenant. Tap to accept.',
    deepLinkPattern: 'pginfo://tenant-home',
    entityType: 'Tenant',
    icon: 'mail-outline',
  },

  // ─── Payment / Rent ─────────────────────────────────────────────────────────
  RENT_GENERATED: {
    category: 'Payment',
    preferenceKey: 'rent_reminders',
    transactional: true,
    title: '💳 Rent Due for {{month}}',
    body: 'Your rent of ₹{{amount}} for {{month}} is due on {{dueDate}}.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'RentRecord',
    icon: 'receipt-outline',
  },
  RENT_DUE_REMINDER_7D: {
    category: 'Reminder',
    preferenceKey: 'rent_reminders',
    transactional: false,
    title: '⏰ Rent Due in 7 Days',
    body: 'Your rent of ₹{{amount}} for {{month}} is due on {{dueDate}}. Pay early to avoid late fees.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'RentRecord',
    icon: 'time-outline',
  },
  RENT_DUE_REMINDER_3D: {
    category: 'Reminder',
    preferenceKey: 'rent_reminders',
    transactional: false,
    title: '⚠️ Rent Due in 3 Days',
    body: 'Your rent of ₹{{amount}} is due on {{dueDate}}. Please pay now to avoid late fees.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'RentRecord',
    icon: 'warning-outline',
  },
  RENT_DUE_REMINDER_1D: {
    category: 'Reminder',
    preferenceKey: 'rent_reminders',
    transactional: false,
    title: '🚨 Rent Due Tomorrow!',
    body: 'Your rent of ₹{{amount}} is due tomorrow. Pay now to avoid a late fee.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'RentRecord',
    icon: 'alert-circle',
  },
  RENT_OVERDUE: {
    category: 'Payment',
    preferenceKey: 'rent_reminders',
    transactional: true,
    title: '🔴 Rent Overdue',
    body: 'Your rent of ₹{{amount}} for {{month}} is overdue. Please pay immediately.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'RentRecord',
    icon: 'alert-circle',
  },
  PAYMENT_SUCCESS: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '✅ Payment Successful',
    body: '₹{{amount}} payment received successfully for {{month}}. Thank you!',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'checkmark-circle',
  },
  PAYMENT_FAILED: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '❌ Payment Failed',
    body: 'Your payment of ₹{{amount}} could not be processed. Please try again.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'close-circle',
  },
  PAYMENT_RECEIPT: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '🧾 Payment Receipt',
    body: 'Receipt for ₹{{amount}} payment on {{date}}. Tap to view.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'document-text-outline',
  },
  MANUAL_PAYMENT_RECORDED: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '💰 Payment Recorded',
    body: 'Your {{method}} payment of ₹{{amount}} has been recorded by your owner.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'cash-outline',
  },
  SECURITY_DEPOSIT_RECEIVED: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '🔒 Security Deposit Received',
    body: 'Your security deposit of ₹{{amount}} has been received by {{pgName}}.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'shield-checkmark-outline',
  },
  SECURITY_DEPOSIT_REFUNDED: {
    category: 'Payment',
    preferenceKey: 'payment_updates',
    transactional: true,
    title: '💸 Security Deposit Refunded',
    body: 'Your security deposit of ₹{{amount}} has been refunded.',
    deepLinkPattern: 'pginfo://tenant-home/payments',
    entityType: 'Payment',
    icon: 'cash',
  },

  // ─── Agreement ──────────────────────────────────────────────────────────────
  AGREEMENT_CREATED: {
    category: 'Agreement',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '📄 Rental Agreement Created',
    body: 'Your rental agreement at {{pgName}} has been created. Agreement #{{agreementNumber}}.',
    deepLinkPattern: 'pginfo://tenant-home/agreement',
    entityType: 'Agreement',
    icon: 'document-outline',
  },
  AGREEMENT_EXPIRING_7D: {
    category: 'Reminder',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '📅 Agreement Expiring Soon',
    body: 'Your rental agreement at {{pgName}} expires on {{endDate}} (7 days left).',
    deepLinkPattern: 'pginfo://tenant-home/agreement',
    entityType: 'Agreement',
    icon: 'calendar-outline',
  },
  AGREEMENT_EXPIRING_3D: {
    category: 'Reminder',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '⚠️ Agreement Expiring in 3 Days',
    body: 'Your rental agreement at {{pgName}} expires on {{endDate}}. Please renew.',
    deepLinkPattern: 'pginfo://tenant-home/agreement',
    entityType: 'Agreement',
    icon: 'warning-outline',
  },
  AGREEMENT_EXPIRED: {
    category: 'Agreement',
    preferenceKey: 'booking_updates',
    transactional: true,
    title: '🔴 Agreement Expired',
    body: 'Your rental agreement at {{pgName}} has expired. Please contact your owner.',
    deepLinkPattern: 'pginfo://tenant-home/agreement',
    entityType: 'Agreement',
    icon: 'alert-circle',
  },
  AGREEMENT_RENEWED: {
    category: 'Agreement',
    preferenceKey: 'booking_updates',
    transactional: true,
    title: '✅ Agreement Renewed',
    body: 'Your rental agreement at {{pgName}} has been renewed until {{endDate}}.',
    deepLinkPattern: 'pginfo://tenant-home/agreement',
    entityType: 'Agreement',
    icon: 'refresh-circle-outline',
  },

  // ─── Jobs ───────────────────────────────────────────────────────────────────
  JOB_POSTED: {
    category: 'Jobs',
    preferenceKey: 'jobs',
    transactional: false,
    title: '💼 New Job: {{jobTitle}}',
    body: '{{pgName}} is hiring a {{role}} in {{city}}. Salary: ₹{{salary}}/month.',
    deepLinkPattern: 'pginfo://jobs/{{entityId}}',
    entityType: 'JobPost',
    icon: 'briefcase-outline',
  },
  JOB_APPLICATION_RECEIVED: {
    category: 'Jobs',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '📥 New Job Application',
    body: '{{applicantName}} applied for {{jobTitle}} at {{pgName}}.',
    deepLinkPattern: 'pginfo://manage/hiring',
    entityType: 'JobApplication',
    icon: 'person-add-outline',
  },
  JOB_APPLICATION_STATUS: {
    category: 'Jobs',
    preferenceKey: 'jobs',
    transactional: false,
    title: '📋 Application Update',
    body: 'Your application for {{jobTitle}} at {{pgName}} has been {{status}}.',
    deepLinkPattern: 'pginfo://jobs/{{entityId}}',
    entityType: 'JobApplication',
    icon: 'clipboard-outline',
  },

  // ─── Visits / Leads ─────────────────────────────────────────────────────────
  NEW_LEAD: {
    category: 'Owner',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '🎯 New Lead',
    body: '{{name}} is interested in {{pgName}}. Contact: {{phone}}',
    deepLinkPattern: 'pginfo://manage',
    entityType: 'Lead',
    icon: 'person-outline',
  },
  VISIT_BOOKED: {
    category: 'Visits',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '📅 Visit Booked',
    body: '{{name}} has booked a visit to {{pgName}} on {{visitDate}}.',
    deepLinkPattern: 'pginfo://visits',
    entityType: 'VisitRequest',
    icon: 'calendar',
  },
  VISIT_REMINDER: {
    category: 'Reminder',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '⏰ Visit Reminder',
    body: 'Your visit to {{pgName}} is tomorrow at {{visitTime}}.',
    deepLinkPattern: 'pginfo://visits',
    entityType: 'VisitRequest',
    icon: 'notifications-outline',
  },
  VISIT_CANCELLED: {
    category: 'Visits',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '❌ Visit Cancelled',
    body: 'The visit to {{pgName}} scheduled for {{visitDate}} has been cancelled.',
    deepLinkPattern: 'pginfo://visits',
    entityType: 'VisitRequest',
    icon: 'close-circle-outline',
  },
  STAFF_ADDED: {
    category: 'Owner',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '👤 Staff Added',
    body: '{{staffName}} has been added as {{role}} at {{pgName}}.',
    deepLinkPattern: 'pginfo://manage',
    entityType: 'Staff',
    icon: 'people-outline',
  },
  STAFF_UPDATE: {
    category: 'Owner',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '📝 Staff Update',
    body: 'Staff record for {{staffName}} at {{pgName}} has been updated.',
    deepLinkPattern: 'pginfo://manage',
    entityType: 'Staff',
    icon: 'people-outline',
  },
  EXPENSE_ADDED: {
    category: 'Owner',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '💸 Expense Recorded',
    body: '₹{{amount}} expense ({{category}}) recorded for {{pgName}}.',
    deepLinkPattern: 'pginfo://manage',
    entityType: 'Expense',
    icon: 'trending-down-outline',
  },

  // ─── Meetups ────────────────────────────────────────────────────────────────
  MEETUP_CREATED: {
    category: 'Meetups',
    preferenceKey: 'announcements',
    transactional: false,
    title: '🤝 New Meetup in {{city}}',
    body: '"{{meetupTitle}}" — {{date}} at {{venue}}. Join other PG residents!',
    deepLinkPattern: 'pginfo://meetup/{{entityId}}',
    entityType: 'Meetup',
    icon: 'people',
  },
  MEETUP_REMINDER: {
    category: 'Reminder',
    preferenceKey: 'booking_updates',
    transactional: false,
    title: '⏰ Meetup Tomorrow',
    body: '"{{meetupTitle}}" is tomorrow at {{time}}, {{venue}}.',
    deepLinkPattern: 'pginfo://meetup/{{entityId}}',
    entityType: 'Meetup',
    icon: 'alarm-outline',
  },

  // ─── Promotional ────────────────────────────────────────────────────────────
  PROMO_NEW_PG: {
    category: 'Promotional',
    preferenceKey: 'promotions',
    transactional: false,
    title: '🏠 New PG in {{city}}',
    body: '"{{pgName}}" is now available in {{area}}. Starting ₹{{rent}}/month.',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'home-outline',
  },
  PROMO_FEATURED_PG: {
    category: 'Promotional',
    preferenceKey: 'promotions',
    transactional: false,
    title: '⭐ Featured PG',
    body: '"{{pgName}}" is a top-rated PG in {{city}}. Check it out!',
    deepLinkPattern: 'pginfo://pg/{{entityId}}',
    entityType: 'PG',
    icon: 'star-outline',
  },
  PROMO_SPECIAL_OFFER: {
    category: 'Promotional',
    preferenceKey: 'promotions',
    transactional: false,
    title: '🎁 Special Offer',
    body: '{{offerText}}',
    deepLinkPattern: 'pginfo://explore',
    entityType: null,
    icon: 'pricetag-outline',
  },
  PLATFORM_ANNOUNCEMENT: {
    category: 'Announcements',
    preferenceKey: 'announcements',
    transactional: false,
    title: '📢 PGinfo.online Update',
    body: '{{message}}',
    deepLinkPattern: 'pginfo://notifications',
    entityType: null,
    icon: 'megaphone-outline',
  },

  // ─── System ─────────────────────────────────────────────────────────────────
  ACCOUNT_WELCOME: {
    category: 'System',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '👋 Welcome to PGinfo.online!',
    body: 'Hi {{name}}! Find your perfect PG or manage your properties with ease.',
    deepLinkPattern: 'pginfo://home',
    entityType: null,
    icon: 'hand-left-outline',
  },
  ROLE_UPGRADED: {
    category: 'System',
    preferenceKey: 'general_alerts',
    transactional: true,
    title: '🎉 Account Upgraded!',
    body: 'Your account has been upgraded to Owner. You can now list and manage PGs.',
    deepLinkPattern: 'pginfo://home',
    entityType: null,
    icon: 'trending-up-outline',
  },
  ADMIN_CUSTOM: {
    category: 'Admin',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '📢 {{title}}',
    body: '{{body}}',
    deepLinkPattern: 'pginfo://notifications',
    entityType: null,
    icon: 'megaphone-outline',
  },
  GENERAL_ALERT: {
    category: 'System',
    preferenceKey: 'general_alerts',
    transactional: false,
    title: '🔔 {{title}}',
    body: '{{body}}',
    deepLinkPattern: 'pginfo://notifications',
    entityType: null,
    icon: 'notifications-outline',
  },
};

/**
 * Interpolate a template string with context variables.
 * Replaces {{key}} with context[key], leaving unknown keys as-is.
 *
 * @param {string} template
 * @param {Object} context
 * @returns {string}
 */
function interpolate(template, context = {}) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });
}

/**
 * Build a notification payload for a given type and context.
 *
 * @param {string} type - A NOTIFICATION_TYPES value
 * @param {Object} context - Variables for template interpolation (pgName, amount, etc.)
 * @returns {{ title: string, body: string, deepLink: string, entityType: string|null }}
 */
function buildPayload(type, context = {}) {
  const config = TYPE_CONFIG[type];
  if (!config) {
    return {
      title: context.title || 'PGinfo.online',
      body:  context.body  || 'You have a new notification.',
      deepLink:   'pginfo://notifications',
      entityType: null,
    };
  }

  const title    = interpolate(config.title, context);
  const body     = interpolate(config.body,  context);
  const deepLink = interpolate(config.deepLinkPattern || 'pginfo://notifications', context);

  return {
    title,
    body,
    deepLink,
    entityType: config.entityType,
    icon: config.icon,
    preferenceKey: config.preferenceKey,
    transactional: config.transactional,
  };
}

/**
 * Get the preference category key for a notification type.
 * Returns null for transactional (cannot be opted out).
 */
function getPreferenceKey(type) {
  const config = TYPE_CONFIG[type];
  if (!config) return 'general_alerts';
  if (config.transactional) return null; // transactional — always send
  return config.preferenceKey;
}

/**
 * Is this notification type transactional (cannot be opted out)?
 */
function isTransactional(type) {
  const config = TYPE_CONFIG[type];
  return config ? config.transactional === true : false;
}

module.exports = {
  NOTIFICATION_TYPES,
  CATEGORIES,
  CATEGORY_LABELS,
  TYPE_CONFIG,
  buildPayload,
  interpolate,
  getPreferenceKey,
  isTransactional,
};

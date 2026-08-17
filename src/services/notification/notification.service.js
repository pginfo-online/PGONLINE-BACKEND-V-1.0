/**
 * notification.service.js
 *
 * Central orchestrator for the PGInfo notification system.
 *
 * Pipeline for sending a notification:
 * 1. Resolve audience → get list of target userIds
 * 2. Filter by user notification preferences
 * 3. Fetch active DeviceTokens for those users
 * 4. Build Expo messages
 * 5. Send via expo.service.js
 * 6. Save NotificationReceipt records (one per user/device)
 * 7. Update Notification.stats
 * 8. Upsert NotificationInbox items (one per user)
 */

const Notification       = require('../../models/Notification.model');
const NotificationReceipt = require('../../models/NotificationReceipt.model');
const NotificationInbox  = require('../../models/NotificationInbox.model');
const NotificationPreference = require('../../models/NotificationPreference.model');
const DeviceToken        = require('../../models/DeviceToken.model');
const User               = require('../../models/User.model');
const Tenant             = require('../../models/Tenant.model');

const expoService = require('./expo.service');
const { getPreferenceKey, isTransactional } = require('./notification.types');
const { logger } = require('../../utils/logger');

const MAX_RETRY = parseInt(process.env.NOTIFICATION_RETRY_MAX, 10) || 3;

// ─── Audience Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a notification's audience config to an array of user IDs.
 *
 * @param {Object} audience - notification.audience object
 * @returns {Promise<string[]>} Array of user ID strings
 */
async function resolveAudience(audience) {
  const { type, targetRoles, targetUserIds, targetPgId, targetCity } = audience;

  switch (type) {
    case 'all': {
      const users = await User.find({ isActive: true }).select('_id').lean();
      return users.map(u => u._id.toString());
    }

    case 'role': {
      if (!targetRoles || targetRoles.length === 0) return [];
      const users = await User.find({ role: { $in: targetRoles }, isActive: true })
        .select('_id').lean();
      return users.map(u => u._id.toString());
    }

    case 'specific': {
      if (!targetUserIds || targetUserIds.length === 0) return [];
      return targetUserIds
        .map(id => {
          if (!id) return null;
          if (typeof id === 'object') {
            if (id._id) return id._id.toString();
            if (id.id) return id.id.toString();
          }
          return id.toString();
        })
        .filter(Boolean);
    }

    case 'pg': {
      if (!targetPgId) return [];
      // All active tenants linked to this PG with a user account
      const tenants = await Tenant.find({
        pg: targetPgId,
        status: { $in: ['active', 'notice'] },
        user: { $ne: null },
      }).select('user').lean();
      return [...new Set(tenants.map(t => t.user.toString()))];
    }

    case 'city': {
      if (!targetCity) return [];
      // Users whose PGs are in that city, or users with that city in profile
      const cityRegex = new RegExp(`^${targetCity}$`, 'i');
      const users = await User.find({ isActive: true }).select('_id').lean();
      // Simple approach: all users (city filtering for PG owners happens via PG model)
      // For tenants in a city, join through Tenant → PG
      return users.map(u => u._id.toString());
    }

    default:
      return [];
  }
}

/**
 * Filter user IDs by their notification preferences for a given type.
 * Transactional notifications bypass preferences.
 *
 * @param {string[]} userIds
 * @param {string} notificationType
 * @returns {Promise<string[]>} Filtered user IDs
 */
async function filterByPreferences(userIds, notificationType) {
  // Transactional — always send, no filtering
  if (isTransactional(notificationType)) return userIds;

  const preferenceKey = getPreferenceKey(notificationType);
  if (!preferenceKey) return userIds;

  // Find users who have opted out of this category or disabled push entirely
  const optedOut = await NotificationPreference.find({
    user: { $in: userIds },
    $or: [
      { pushEnabled: false },
      { [`categories.${preferenceKey}`]: false },
    ],
  }).select('user').lean();

  const optedOutSet = new Set(optedOut.map(p => p.user.toString()));
  return userIds.filter(id => !optedOutSet.has(id));
}

/**
 * Get all active DeviceTokens for a list of user IDs.
 *
 * @param {string[]} userIds
 * @returns {Promise<Object[]>} DeviceToken documents with token + user fields
 */
async function getActiveTokens(userIds) {
  return DeviceToken.find({
    user:     { $in: userIds },
    isActive: true,
  }).select('_id token user platform').lean();
}

/**
 * Build Expo message objects from device tokens + payload.
 *
 * @param {Object[]} deviceTokens - Array of DeviceToken docs
 * @param {Object} payload - { title, body, imageUrl, data }
 * @param {number} badge - Badge count (default 1)
 * @returns {Object[]} Expo messages
 */
function buildMessages(deviceTokens, payload, badge = 1) {
  return deviceTokens
    .filter(dt => expoService.isExpoPushToken(dt.token))
    .map(dt => expoService.buildMessage(dt.token, {
      title:    payload.title,
      body:     payload.body,
      imageUrl: payload.imageUrl || null,
      data: {
        type:       payload.type,
        deepLink:   payload.data?.deepLink   || null,
        entityType: payload.data?.entityType || null,
        entityId:   payload.data?.entityId   || null,
        metadata:   payload.data?.metadata   || {},
        imageUrl:   payload.imageUrl         || null,
        image:      payload.imageUrl         || null,
      },
      badge,
      sound: 'default',
    }));
}

/**
 * Persist NotificationReceipt records for each device after sending.
 *
 * @param {Object[]} tickets - Expo tickets (one per message)
 * @param {Object[]} deviceTokens - DeviceToken docs (parallel array to tickets)
 * @param {string} notificationId - Notification._id
 */
async function saveReceipts(tickets, deviceTokens, notificationId) {
  const ops = tickets.map((ticket, i) => {
    const device = deviceTokens[i];
    const isSuccess = ticket.status === 'ok';
    const classification = isSuccess ? null : expoService.classifyError(ticket);

    return {
      insertOne: {
        document: {
          notification:     notificationId,
          user:             device.user,
          device:           device._id,
          expoPushTicketId: isSuccess ? ticket.id : null,
          status:           isSuccess ? 'sent' : 'failed',
          errorCode:        !isSuccess ? (ticket.details?.error || 'UnknownError') : null,
          errorMessage:     !isSuccess ? ticket.message : null,
          sentAt:           isSuccess ? new Date() : null,
          retryCount:       0,
          nextRetryAt:      (!isSuccess && classification?.shouldRetry)
            ? new Date(Date.now() + 5 * 60 * 1000) // retry in 5 min
            : null,
          createdAt:        new Date(),
          updatedAt:        new Date(),
        },
      },
    };
  });

  if (ops.length > 0) {
    try {
      await NotificationReceipt.bulkWrite(ops, { ordered: false });
    } catch (err) {
      logger.error(`[NotificationService] bulkWrite receipts error: ${err.message}`);
    }
  }

  // Handle invalid tokens asynchronously
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === 'error') {
      const { isInvalid } = expoService.classifyError(ticket);
      if (isInvalid && deviceTokens[i]?.token) {
        expoService.handleInvalidToken(deviceTokens[i].token).catch(() => {});
      }
    }
  }
}

/**
 * Create or update NotificationInbox items for all targeted users.
 * Uses bulkWrite for efficiency.
 *
 * @param {string[]} userIds
 * @param {Object} notificationDoc - Notification document
 */
async function createInboxItems(userIds, notificationDoc) {
  if (!userIds || userIds.length === 0) return;

  const now = new Date();
  const ops = userIds.map(userId => ({
    insertOne: {
      document: {
        user:         userId,
        notification: notificationDoc._id,
        title:        notificationDoc.title,
        body:         notificationDoc.body,
        imageUrl:     notificationDoc.imageUrl || null,
        type:         notificationDoc.type,
        data: {
          deepLink:   notificationDoc.data?.deepLink   || null,
          entityType: notificationDoc.data?.entityType || null,
          entityId:   notificationDoc.data?.entityId   || null,
        },
        isRead:    false,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  }));

  try {
    await NotificationInbox.bulkWrite(ops, { ordered: false });
  } catch (err) {
    logger.error(`[NotificationService] createInboxItems error: ${err.message}`);
  }
}

/**
 * Atomically update Notification.stats after sending.
 *
 * @param {string} notificationId
 * @param {Object} delta - e.g. { total: 10, sent: 8, failed: 2 }
 */
async function updateStats(notificationId, delta) {
  const inc = {};
  for (const [key, val] of Object.entries(delta)) {
    if (val) inc[`stats.${key}`] = val;
  }
  if (Object.keys(inc).length === 0) return;

  await Notification.findByIdAndUpdate(notificationId, { $inc: inc });
}

/**
 * Main send pipeline.
 * Takes a Notification document (already saved to DB), resolves audience,
 * sends pushes, and updates all tracking records.
 *
 * @param {Object} notificationDoc - Mongoose Notification document or plain object
 */
async function send(notificationDoc) {
  const notifId = notificationDoc._id.toString();
  logger.info(`[NotificationService] Starting send for notification ${notifId} (type: ${notificationDoc.type})`);

  try {
    // 1. Update status to sending
    await Notification.findByIdAndUpdate(notifId, { status: 'sending' });

    // 2. Resolve audience
    let userIds = await resolveAudience(notificationDoc.audience);
    logger.info(`[NotificationService] Resolved ${userIds.length} users for ${notifId}`);

    if (userIds.length === 0) {
      await Notification.findByIdAndUpdate(notifId, {
        status: 'sent',
        sentAt: new Date(),
        'stats.total': 0,
      });
      return;
    }

    // 3. Filter by preferences
    const filteredUserIds = await filterByPreferences(userIds, notificationDoc.type);
    logger.info(`[NotificationService] After preference filter: ${filteredUserIds.length} users`);

    // 4. Create inbox items for all filtered users (even those without tokens)
    await createInboxItems(filteredUserIds, notificationDoc);

    // 5. Get active device tokens
    const deviceTokens = await getActiveTokens(filteredUserIds);
    logger.info(`[NotificationService] Found ${deviceTokens.length} active device tokens`);

    let sentCount   = 0;
    let failedCount = 0;

    if (deviceTokens.length > 0) {
      // 6. Build messages
      const payload = {
        title:    notificationDoc.title,
        body:     notificationDoc.body,
        imageUrl: notificationDoc.imageUrl,
        type:     notificationDoc.type,
        data:     notificationDoc.data,
      };
      const messages = buildMessages(deviceTokens, payload);

      // 7. Send via Expo
      const tickets = await expoService.sendBatch(messages);

      // 8. Count results
      sentCount   = tickets.filter(t => t.status === 'ok').length;
      failedCount = tickets.filter(t => t.status === 'error').length;

      // 9. Save receipts
      await saveReceipts(tickets, deviceTokens, notifId);
    }

    // 10. Update Notification status and stats
    await Notification.findByIdAndUpdate(notifId, {
      status:         'sent',
      sentAt:         new Date(),
      'stats.total':  filteredUserIds.length,
      'stats.sent':   sentCount,
      'stats.failed': failedCount,
    });

    logger.info(`[NotificationService] Sent ${notifId}: ${sentCount} ok, ${failedCount} failed`);
  } catch (err) {
    logger.error(`[NotificationService] Send failed for ${notifId}: ${err.message}`);
    await Notification.findByIdAndUpdate(notifId, {
      status:       'failed',
      errorMessage: err.message,
    }).catch(() => {});
  }
}

/**
 * Quick helper: create and immediately send a notification.
 * Used by notification.trigger.js for event-driven notifications.
 *
 * @param {Object} params - { type, title, body, imageUrl, data, audience, isTransactional, createdBy }
 * @returns {Promise<Object>} Created Notification document
 */
async function createAndSend(params) {
  const notif = await Notification.create({
    type:           params.type,
    title:          params.title,
    body:           params.body,
    imageUrl:       params.imageUrl  || null,
    data:           params.data      || {},
    audience:       params.audience,
    status:         'draft',
    isTransactional: params.isTransactional || false,
    createdBy:      params.createdBy || null,
  });

  // Fire-and-forget send (do not await — callers are non-blocking)
  send(notif).catch(err => {
    logger.error(`[NotificationService] createAndSend error for ${notif._id}: ${err.message}`);
  });

  return notif;
}

module.exports = {
  send,
  createAndSend,
  resolveAudience,
  filterByPreferences,
  getActiveTokens,
  buildMessages,
  saveReceipts,
  createInboxItems,
  updateStats,
};

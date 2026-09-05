/**
 * notification.controller.js
 *
 * User-facing notification endpoints:
 * - Device token management
 * - Notification inbox (read/unread)
 * - Notification preferences
 */

const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const DeviceToken           = require('../models/DeviceToken.model');
const NotificationInbox     = require('../models/NotificationInbox.model');
const NotificationPreference = require('../models/NotificationPreference.model');
const NotificationReceipt   = require('../models/NotificationReceipt.model');
const expoService = require('../services/notification/expo.service');

// ─── Device Management ────────────────────────────────────────────────────────

/**
 * POST /api/v1/notifications/devices
 * Register or update a device push token for the current user.
 */
exports.registerDevice = asyncHandler(async (req, res) => {
  const { token, platform = 'android', deviceName, appVersion } = req.body;

  if (!token) return errorResponse(res, 'Push token is required', 400);

  if (!expoService.isExpoPushToken(token)) {
    return errorResponse(res, 'Invalid Expo push token format', 400);
  }

  // Upsert: if token already exists, update it; otherwise create
  const device = await DeviceToken.findOneAndUpdate(
    { token },
    {
      user:       req.user._id,
      token,
      platform,
      deviceName: deviceName || null,
      appVersion: appVersion || null,
      isActive:   true,
      lastUsedAt: new Date(),
      deactivatedReason: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Also keep User.pushToken in sync for backward compat
  await req.user.constructor.findByIdAndUpdate(req.user._id, { pushToken: token });

  return successResponse(res, 'Device registered', { deviceId: device._id, token: device.token }, 201);
});

/**
 * PUT /api/v1/notifications/devices/:id
 * Update device metadata (appVersion, lastUsedAt).
 */
exports.updateDevice = asyncHandler(async (req, res) => {
  const device = await DeviceToken.findOne({ _id: req.params.id, user: req.user._id });
  if (!device) return errorResponse(res, 'Device not found', 404);

  if (req.body.appVersion) device.appVersion = req.body.appVersion;
  device.lastUsedAt = new Date();
  await device.save();

  return successResponse(res, 'Device updated', device);
});

/**
 * DELETE /api/v1/notifications/devices/:id
 * Deactivate a device token (on logout or token refresh).
 */
exports.removeDevice = asyncHandler(async (req, res) => {
  // Allow removal by device ID or by token string
  const filter = req.params.id === 'by-token'
    ? { token: req.body.token, user: req.user._id }
    : { _id: req.params.id,   user: req.user._id };

  const device = await DeviceToken.findOneAndUpdate(
    filter,
    { isActive: false, deactivatedReason: 'UserLogout' },
    { new: true }
  );

  if (!device) return errorResponse(res, 'Device not found', 404);
  return successResponse(res, 'Device deactivated');
});

// ─── Notification Inbox ───────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications
 * Paginated inbox for the current user (newest first, not deleted).
 */
exports.getMyNotifications = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = { user: req.user._id, isDeleted: false };

  // Optional filter: only unread
  if (req.query.unread === 'true') filter.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    NotificationInbox.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationInbox.countDocuments(filter),
    NotificationInbox.countDocuments({ user: req.user._id, isRead: false, isDeleted: false }),
  ]);

  res.setHeader('X-Unread-Count', unreadCount);

  return paginatedResponse(res, 'Notifications fetched', items, {
    page, limit, total, pages: Math.ceil(total / limit), unreadCount,
  });
});

/**
 * GET /api/v1/notifications/unread-count
 * Fast unread count for badge display.
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const count = await NotificationInbox.countDocuments({
    user:      req.user._id,
    isRead:    false,
    isDeleted: false,
  });
  return successResponse(res, 'Unread count', { count });
});

/**
 * GET /api/v1/notifications/:id
 * Get single notification detail and auto-mark as read.
 */
exports.getNotificationById = asyncHandler(async (req, res) => {
  const item = await NotificationInbox.findOne({
    _id: req.params.id,
    user: req.user._id,
    isDeleted: false,
  });

  if (!item) return errorResponse(res, 'Notification not found', 404);

  if (!item.isRead) {
    item.isRead = true;
    item.readAt = new Date();
    await item.save();

    if (item.notification) {
      NotificationReceipt.findOneAndUpdate(
        { notification: item.notification, user: req.user._id },
        { status: 'opened', openedAt: new Date() }
      ).catch(() => {});
    }
  }

  return successResponse(res, 'Notification details fetched', item);
});

/**
 * PUT /api/v1/notifications/:id/read
 * Mark a single notification as read.
 */
exports.markRead = asyncHandler(async (req, res) => {
  const item = await NotificationInbox.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, isDeleted: false },
    { isRead: true, readAt: new Date() },
    { new: true }
  );

  if (!item) return errorResponse(res, 'Notification not found', 404);

  // Also update receipt status to opened
  if (item.notification) {
    NotificationReceipt.findOneAndUpdate(
      { notification: item.notification, user: req.user._id },
      { status: 'opened', openedAt: new Date() }
    ).catch(() => {});
  }

  return successResponse(res, 'Marked as read', { isRead: true });
});

/**
 * PUT /api/v1/notifications/read-all
 * Mark all unread notifications as read.
 */
exports.markAllRead = asyncHandler(async (req, res) => {
  const result = await NotificationInbox.updateMany(
    { user: req.user._id, isRead: false, isDeleted: false },
    { isRead: true, readAt: new Date() }
  );
  return successResponse(res, 'All notifications marked as read', { modified: result.modifiedCount });
});

/**
 * DELETE /api/v1/notifications/:id
 * Soft-delete a notification from inbox.
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  const item = await NotificationInbox.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isDeleted: true, deletedAt: new Date(), isRead: true },
    { new: true }
  );
  if (!item) return errorResponse(res, 'Notification not found', 404);
  return successResponse(res, 'Notification removed from inbox');
});

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/preferences
 * Get or create notification preferences for the current user.
 */
exports.getPreferences = asyncHandler(async (req, res) => {
  // findOneAndUpdate with upsert creates defaults if not exists
  const prefs = await NotificationPreference.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return successResponse(res, 'Preferences fetched', prefs);
});

/**
 * PUT /api/v1/notifications/preferences
 * Update notification preferences (partial update supported).
 */
exports.updatePreferences = asyncHandler(async (req, res) => {
  const { pushEnabled, categories } = req.body;

  const updateData = {};
  if (typeof pushEnabled === 'boolean') {
    updateData.pushEnabled = pushEnabled;
  }

  // Merge category preferences (only update provided keys)
  if (categories && typeof categories === 'object') {
    const ALLOWED_CATEGORIES = [
      'pg_updates', 'booking_updates', 'payment_updates', 'rent_reminders',
      'complaints', 'maintenance', 'tasks', 'jobs', 'promotions', 'announcements',
      'general_alerts', 'buffet_updates', 'buffet_reservations',
    ];
    for (const key of ALLOWED_CATEGORIES) {
      if (typeof categories[key] === 'boolean') {
        updateData[`categories.${key}`] = categories[key];
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse(res, 'No valid preference fields provided', 400);
  }

  const prefs = await NotificationPreference.findOneAndUpdate(
    { user: req.user._id },
    { $set: updateData },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return successResponse(res, 'Preferences updated', prefs);
});

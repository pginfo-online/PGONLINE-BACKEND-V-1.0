/**
 * admin.notification.controller.js
 *
 * Admin-only notification management endpoints:
 * - Create, schedule, send, cancel, retry notifications
 * - View delivery receipts and stats
 * - Manage notification templates
 */

const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const Notification           = require('../models/Notification.model');
const NotificationReceipt    = require('../models/NotificationReceipt.model');
const NotificationInbox      = require('../models/NotificationInbox.model');
const NotificationTemplate   = require('../models/NotificationTemplate.model');
const User                   = require('../models/User.model');
const Tenant                 = require('../models/Tenant.model');
const notificationService    = require('../services/notification/notification.service');

// ─── Notification CRUD ────────────────────────────────────────────────────────

/**
 * POST /api/v1/admin/notifications
 * Create a new notification (draft, scheduled, or send immediately).
 *
 * Body: { type, title, body, imageUrl, data, audience, scheduledAt, sendNow }
 */
exports.createNotification = asyncHandler(async (req, res) => {
  const {
    type, title, body, imageUrl,
    data, audience, scheduledAt, sendNow,
    isTransactional, template,
  } = req.body;

  if (!type || !title || !body || !audience) {
    return errorResponse(res, 'type, title, body, and audience are required', 400);
  }

  // Determine initial status
  let status = 'draft';
  if (scheduledAt && !sendNow) {
    status = 'scheduled';
  }

  const notif = await Notification.create({
    type,
    title,
    body,
    imageUrl:       imageUrl || null,
    data:           data     || {},
    audience,
    status,
    scheduledAt:    scheduledAt ? new Date(scheduledAt) : null,
    isTransactional: isTransactional || false,
    template:       template || null,
    createdBy:      req.user._id,
  });

  // Send immediately if requested
  if (sendNow) {
    notificationService.send(notif).catch(err => {
      console.error('[AdminNotification] send error:', err.message);
    });
    return successResponse(res, 'Notification created and dispatch started', { notification: notif }, 201);
  }

  return successResponse(res, `Notification ${status === 'scheduled' ? 'scheduled' : 'saved as draft'}`, { notification: notif }, 201);
});

/**
 * GET /api/v1/admin/notifications
 * List all notifications with filters and pagination.
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.type)   filter.type   = req.query.type;

  if (req.query.search) {
    const rx = new RegExp(req.query.search, 'i');
    filter.$or = [{ title: rx }, { body: rx }];
  }

  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Notifications fetched', items, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

/**
 * GET /api/v1/admin/notifications/stats
 * Aggregated stats for the admin dashboard.
 */
exports.getStats = asyncHandler(async (req, res) => {
  const [statusStats, typeStats, recentNotifs] = await Promise.all([
    Notification.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: { status: 'sent' } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Notification.find({ status: 'sent' })
      .sort({ sentAt: -1 })
      .limit(5)
      .select('title type stats sentAt')
      .lean(),
  ]);

  // Aggregate totals
  const totals = { draft: 0, scheduled: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const s of statusStats) {
    totals[s._id] = s.count;
  }

  // Delivery rate across all sent notifications
  const sentAgg = await Notification.aggregate([
    { $match: { status: 'sent' } },
    { $group: {
      _id: null,
      totalSent:      { $sum: '$stats.total' },
      totalDelivered: { $sum: '$stats.delivered' },
      totalOpened:    { $sum: '$stats.opened' },
      totalFailed:    { $sum: '$stats.failed' },
    }},
  ]);

  const agg = sentAgg[0] || { totalSent: 0, totalDelivered: 0, totalOpened: 0, totalFailed: 0 };
  const deliveryRate = agg.totalSent > 0
    ? Math.round((agg.totalDelivered / agg.totalSent) * 100)
    : 0;
  const openRate = agg.totalSent > 0
    ? Math.round((agg.totalOpened / agg.totalSent) * 100)
    : 0;

  return successResponse(res, 'Notification stats', {
    statusTotals: totals,
    deliveryRate,
    openRate,
    totalPushed:  agg.totalSent,
    topTypes:     typeStats,
    recentNotifs,
  });
});

/**
 * POST /api/v1/admin/notifications/audience-count
 * Preview how many users will receive a notification for a given audience config.
 */
exports.getAudienceCount = asyncHandler(async (req, res) => {
  const { audience } = req.body;
  if (!audience || !audience.type) {
    return errorResponse(res, 'audience.type is required', 400);
  }

  try {
    const userIds = await notificationService.resolveAudience(audience);
    return successResponse(res, 'Audience count', { count: userIds.length });
  } catch (err) {
    return errorResponse(res, `Failed to resolve audience: ${err.message}`, 400);
  }
});

/**
 * GET /api/v1/admin/notifications/:id
 * Get a single notification with full stats.
 */
exports.getNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id)
    .populate('createdBy', 'name email')
    .populate('template',  'name')
    .lean();

  if (!notif) return errorResponse(res, 'Notification not found', 404);
  return successResponse(res, 'Notification fetched', notif);
});

/**
 * PUT /api/v1/admin/notifications/:id
 * Update a draft or scheduled notification.
 */
exports.updateNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (!notif) return errorResponse(res, 'Notification not found', 404);

  if (!['draft', 'scheduled'].includes(notif.status)) {
    return errorResponse(res, `Cannot edit a notification with status "${notif.status}"`, 400);
  }

  const ALLOWED = ['title', 'body', 'imageUrl', 'data', 'audience', 'scheduledAt', 'type', 'isTransactional'];
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) notif[key] = req.body[key];
  }

  // Update status if scheduledAt is added/removed
  if (req.body.scheduledAt) {
    notif.status = 'scheduled';
  } else if (notif.status === 'scheduled' && req.body.scheduledAt === null) {
    notif.status = 'draft';
  }

  await notif.save();
  return successResponse(res, 'Notification updated', notif);
});

/**
 * PUT /api/v1/admin/notifications/:id/cancel
 * Cancel a scheduled notification.
 */
exports.cancelNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (!notif) return errorResponse(res, 'Notification not found', 404);

  if (notif.status !== 'scheduled') {
    return errorResponse(res, `Only scheduled notifications can be cancelled (current: ${notif.status})`, 400);
  }

  notif.status = 'cancelled';
  await notif.save();
  return successResponse(res, 'Notification cancelled', notif);
});

/**
 * POST /api/v1/admin/notifications/:id/send
 * Send a draft/scheduled notification immediately.
 */
exports.sendNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (!notif) return errorResponse(res, 'Notification not found', 404);

  if (!['draft', 'scheduled'].includes(notif.status)) {
    return errorResponse(res, `Cannot send a notification with status "${notif.status}"`, 400);
  }

  // Fire dispatch asynchronously
  notificationService.send(notif).catch(err => {
    console.error('[AdminNotification] send error:', err.message);
  });

  return successResponse(res, 'Notification dispatch started', { notificationId: notif._id });
});

/**
 * POST /api/v1/admin/notifications/:id/retry
 * Retry a failed notification.
 */
exports.retryNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (!notif) return errorResponse(res, 'Notification not found', 404);

  if (notif.status !== 'failed') {
    return errorResponse(res, `Only failed notifications can be retried (current: ${notif.status})`, 400);
  }

  // Reset to scheduled so the scheduler or manual send picks it up
  notif.status = 'draft';
  notif.errorMessage = null;
  await notif.save();

  notificationService.send(notif).catch(err => {
    console.error('[AdminNotification] retry error:', err.message);
  });

  return successResponse(res, 'Notification retry dispatch started');
});

/**
 * GET /api/v1/admin/notifications/:id/receipts
 * Paginated list of per-user delivery receipts for a notification.
 */
exports.getReceipts = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const skip  = (page - 1) * limit;

  const filter = { notification: req.params.id };
  if (req.query.status) filter.status = req.query.status;

  const [receipts, total] = await Promise.all([
    NotificationReceipt.find(filter)
      .populate('user',   'name email phone')
      .populate('device', 'platform deviceName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationReceipt.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Receipts fetched', receipts, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

// ─── Template Management ──────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/notifications/templates
 */
exports.getTemplates = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.type) filter.type = req.query.type;

  const templates = await NotificationTemplate.find(filter)
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(res, 'Templates fetched', templates);
});

/**
 * POST /api/v1/admin/notifications/templates
 */
exports.createTemplate = asyncHandler(async (req, res) => {
  const { name, type, titleTemplate, bodyTemplate, imageUrl, defaultData } = req.body;

  if (!name || !titleTemplate || !bodyTemplate) {
    return errorResponse(res, 'name, titleTemplate, and bodyTemplate are required', 400);
  }

  const template = await NotificationTemplate.create({
    name, type, titleTemplate, bodyTemplate,
    imageUrl:    imageUrl    || null,
    defaultData: defaultData || {},
    createdBy:   req.user._id,
    isActive:    true,
  });

  return successResponse(res, 'Template created', template, 201);
});

/**
 * PUT /api/v1/admin/notifications/templates/:id
 */
exports.updateTemplate = asyncHandler(async (req, res) => {
  const template = await NotificationTemplate.findById(req.params.id);
  if (!template) return errorResponse(res, 'Template not found', 404);

  const ALLOWED = ['name', 'type', 'titleTemplate', 'bodyTemplate', 'imageUrl', 'defaultData', 'isActive'];
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) template[key] = req.body[key];
  }

  await template.save();
  return successResponse(res, 'Template updated', template);
});

/**
 * DELETE /api/v1/admin/notifications/templates/:id
 */
exports.deleteTemplate = asyncHandler(async (req, res) => {
  const template = await NotificationTemplate.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!template) return errorResponse(res, 'Template not found', 404);
  return successResponse(res, 'Template deleted');
});

/**
 * notification.scheduler.js
 *
 * Background cron jobs for the notification system.
 *
 * Jobs:
 * 1. Process scheduled notifications (every 1 minute)
 * 2. Poll Expo receipts (every 5 minutes)
 * 3. Retry failed receipts (every 15 minutes)
 * 4. Rent due reminders (daily at 9 AM IST)
 * 5. Rent overdue alerts (daily at 9 AM IST)
 * 6. Agreement expiry reminders (daily at 10 AM IST)
 *
 * Started from server.js after DB connection.
 */

const cron = require('node-cron');
const { logger } = require('../../utils/logger');

// ─── Models ───────────────────────────────────────────────────────────────────
const Notification        = require('../../models/Notification.model');
const NotificationReceipt = require('../../models/NotificationReceipt.model');

// ─── Services ─────────────────────────────────────────────────────────────────
const notificationService = require('./notification.service');
const expoService         = require('./expo.service');
const { NOTIFICATION_TYPES, buildPayload } = require('./notification.types');

const MAX_RETRY = parseInt(process.env.NOTIFICATION_RETRY_MAX, 10) || 3;

// ─── Job 1: Process Scheduled Notifications ───────────────────────────────────

async function processScheduledNotifications() {
  try {
    const now = new Date();

    // Find scheduled notifications due for sending
    const due = await Notification.find({
      status:      'scheduled',
      scheduledAt: { $lte: now },
    }).limit(20).lean();

    if (due.length === 0) return;

    logger.info(`[Scheduler] Processing ${due.length} scheduled notification(s)`);

    for (const notif of due) {
      // Mark as sending to prevent double-processing
      const updated = await Notification.findOneAndUpdate(
        { _id: notif._id, status: 'scheduled' },
        { status: 'sending' },
        { new: true }
      );

      if (!updated) continue; // Another process grabbed it

      await notificationService.send(updated);
    }
  } catch (err) {
    logger.error(`[Scheduler] processScheduledNotifications error: ${err.message}`);
  }
}

// ─── Job 2: Poll Expo Receipts ────────────────────────────────────────────────

async function pollExpoReceipts() {
  try {
    // Find receipts that were sent but not yet confirmed
    const pending = await NotificationReceipt.find({
      status:           'sent',
      expoPushTicketId: { $ne: null },
      sentAt:           { $lte: new Date(Date.now() - 2 * 60 * 1000) }, // at least 2 min old
    }).select('_id notification expoPushTicketId device').limit(500).lean();

    if (pending.length === 0) return;

    logger.info(`[Scheduler] Polling receipts for ${pending.length} ticket(s)`);

    const ticketIds = pending.map(r => r.expoPushTicketId);
    const receipts  = await expoService.fetchReceipts(ticketIds);

    // Update receipts based on Expo response
    const bulkOps = [];

    for (const receipt of pending) {
      const expoReceipt = receipts[receipt.expoPushTicketId];
      if (!expoReceipt) continue;

      if (expoReceipt.status === 'ok') {
        bulkOps.push({
          updateOne: {
            filter: { _id: receipt._id },
            update: {
              status:       'delivered',
              deliveredAt:  new Date(),
              expoReceiptId: receipt.expoPushTicketId,
            },
          },
        });

        // Increment stats
        await Notification.findByIdAndUpdate(receipt.notification, {
          $inc: { 'stats.delivered': 1 },
        });
      } else if (expoReceipt.status === 'error') {
        const { isInvalid } = expoService.classifyError(expoReceipt);

        bulkOps.push({
          updateOne: {
            filter: { _id: receipt._id },
            update: {
              status:       'failed',
              errorCode:    expoReceipt.details?.error || 'ReceiptError',
              errorMessage: expoReceipt.message,
            },
          },
        });

        if (isInvalid && receipt.device) {
          // Deactivate the device token
          const DeviceToken = require('../../models/DeviceToken.model');
          await DeviceToken.findByIdAndUpdate(receipt.device, {
            isActive:          false,
            deactivatedReason: 'DeviceNotRegistered',
          });
        }
      }
    }

    if (bulkOps.length > 0) {
      await NotificationReceipt.bulkWrite(bulkOps, { ordered: false });
    }
  } catch (err) {
    logger.error(`[Scheduler] pollExpoReceipts error: ${err.message}`);
  }
}

// ─── Job 3: Retry Failed Receipts ─────────────────────────────────────────────

async function retryFailedReceipts() {
  try {
    const now = new Date();
    const retryable = await NotificationReceipt.find({
      status:      'failed',
      retryCount:  { $lt: MAX_RETRY },
      nextRetryAt: { $lte: now },
    }).populate('notification', 'title body imageUrl data type')
      .populate('device', 'token')
      .limit(100)
      .lean();

    if (retryable.length === 0) return;

    logger.info(`[Scheduler] Retrying ${retryable.length} failed receipt(s)`);

    for (const receipt of retryable) {
      if (!receipt.device?.token || !receipt.notification) continue;

      const notif = receipt.notification;
      const message = expoService.buildMessage(receipt.device.token, {
        title:    notif.title,
        body:     notif.body,
        imageUrl: notif.imageUrl,
        data:     notif.data,
      });

      try {
        const tickets = await expoService.sendBatch([message]);
        const ticket  = tickets[0];

        const newRetryCount = receipt.retryCount + 1;
        const maxed = newRetryCount >= MAX_RETRY;

        await NotificationReceipt.findByIdAndUpdate(receipt._id, {
          retryCount:       newRetryCount,
          status:           ticket.status === 'ok' ? 'sent' : (maxed ? 'failed' : 'failed'),
          expoPushTicketId: ticket.status === 'ok' ? ticket.id : null,
          sentAt:           ticket.status === 'ok' ? new Date() : null,
          nextRetryAt:      (!maxed && ticket.status !== 'ok')
            ? new Date(Date.now() + (newRetryCount * 10 * 60 * 1000)) // exponential backoff
            : null,
        });
      } catch (e) {
        logger.error(`[Scheduler] Retry send error for receipt ${receipt._id}: ${e.message}`);
      }
    }
  } catch (err) {
    logger.error(`[Scheduler] retryFailedReceipts error: ${err.message}`);
  }
}

// ─── Job 4 & 5: Rent Reminders & Overdue Alerts ───────────────────────────────

async function runRentReminders() {
  try {
    const RentRecord = require('../../models/RentRecord.model');
    const Tenant     = require('../../models/Tenant.model');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Helper to get target date range
    const daysAhead = (d) => {
      const t = new Date(today);
      t.setDate(t.getDate() + d);
      return { start: t, end: new Date(t.getTime() + 86400000) };
    };

    // 7-day reminder
    const r7 = daysAhead(7);
    const due7 = await RentRecord.find({
      status:  { $in: ['pending', 'partial'] },
      dueDate: { $gte: r7.start, $lt: r7.end },
    }).populate('tenant', 'user name').lean();

    for (const rec of due7) {
      if (!rec.tenant?.user) continue;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const payload = buildPayload(NOTIFICATION_TYPES.RENT_DUE_REMINDER_7D, {
        amount:  `₹${rec.totalAmount.toLocaleString('en-IN')}`,
        month:   `${months[rec.billingMonth - 1]} ${rec.billingYear}`,
        dueDate: new Date(rec.dueDate).toLocaleDateString('en-IN'),
      });
      await notificationService.createAndSend({
        type:  NOTIFICATION_TYPES.RENT_DUE_REMINDER_7D,
        title: payload.title,
        body:  payload.body,
        data: { deepLink: 'pginfo://tenant-home/payments', entityType: 'RentRecord', entityId: rec._id.toString() },
        audience: { type: 'specific', targetUserIds: [rec.tenant.user] },
        isTransactional: false,
      });
    }

    // 3-day reminder
    const r3 = daysAhead(3);
    const due3 = await RentRecord.find({
      status:  { $in: ['pending', 'partial'] },
      dueDate: { $gte: r3.start, $lt: r3.end },
    }).populate('tenant', 'user name').lean();

    for (const rec of due3) {
      if (!rec.tenant?.user) continue;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const payload = buildPayload(NOTIFICATION_TYPES.RENT_DUE_REMINDER_3D, {
        amount:  `₹${rec.totalAmount.toLocaleString('en-IN')}`,
        dueDate: new Date(rec.dueDate).toLocaleDateString('en-IN'),
      });
      await notificationService.createAndSend({
        type:  NOTIFICATION_TYPES.RENT_DUE_REMINDER_3D,
        title: payload.title,
        body:  payload.body,
        data: { deepLink: 'pginfo://tenant-home/payments', entityType: 'RentRecord', entityId: rec._id.toString() },
        audience: { type: 'specific', targetUserIds: [rec.tenant.user] },
        isTransactional: false,
      });
    }

    // 1-day reminder
    const r1 = daysAhead(1);
    const due1 = await RentRecord.find({
      status:  { $in: ['pending', 'partial'] },
      dueDate: { $gte: r1.start, $lt: r1.end },
    }).populate('tenant', 'user name').lean();

    for (const rec of due1) {
      if (!rec.tenant?.user) continue;
      const payload = buildPayload(NOTIFICATION_TYPES.RENT_DUE_REMINDER_1D, {
        amount:  `₹${rec.totalAmount.toLocaleString('en-IN')}`,
        dueDate: new Date(rec.dueDate).toLocaleDateString('en-IN'),
      });
      await notificationService.createAndSend({
        type:  NOTIFICATION_TYPES.RENT_DUE_REMINDER_1D,
        title: payload.title,
        body:  payload.body,
        data: { deepLink: 'pginfo://tenant-home/payments', entityType: 'RentRecord', entityId: rec._id.toString() },
        audience: { type: 'specific', targetUserIds: [rec.tenant.user] },
        isTransactional: false,
      });
    }

    // Overdue check — records past due date and still unpaid
    const overdue = await RentRecord.find({
      status:  { $in: ['pending', 'partial'] },
      dueDate: { $lt: today },
    }).populate('tenant', 'user owner').lean();

    for (const rec of overdue) {
      if (!rec.tenant?.user) continue;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const payload = buildPayload(NOTIFICATION_TYPES.RENT_OVERDUE, {
        amount: `₹${rec.totalAmount.toLocaleString('en-IN')}`,
        month:  `${months[rec.billingMonth - 1]} ${rec.billingYear}`,
      });
      await notificationService.createAndSend({
        type:  NOTIFICATION_TYPES.RENT_OVERDUE,
        title: payload.title,
        body:  payload.body,
        data: { deepLink: 'pginfo://tenant-home/payments', entityType: 'RentRecord', entityId: rec._id.toString() },
        audience: { type: 'specific', targetUserIds: [rec.tenant.user] },
        isTransactional: true,
      });
    }

    logger.info(`[Scheduler] Rent reminders sent: 7d=${due7.length}, 3d=${due3.length}, 1d=${due1.length}, overdue=${overdue.length}`);
  } catch (err) {
    logger.error(`[Scheduler] runRentReminders error: ${err.message}`);
  }
}

// ─── Job 6: Agreement Expiry Reminders ────────────────────────────────────────

async function runAgreementReminders() {
  try {
    const Agreement = require('../../models/Agreement.model');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysAhead = (d) => {
      const t = new Date(today);
      t.setDate(t.getDate() + d);
      return { start: t, end: new Date(t.getTime() + 86400000) };
    };

    for (const [days, type] of [[7, NOTIFICATION_TYPES.AGREEMENT_EXPIRING_7D], [3, NOTIFICATION_TYPES.AGREEMENT_EXPIRING_3D]]) {
      const range = daysAhead(days);
      const agreements = await Agreement.find({
        status:  'active',
        endDate: { $gte: range.start, $lt: range.end },
      }).populate('tenant', 'user')
        .populate('pg',     'name owner')
        .lean();

      for (const agr of agreements) {
        if (!agr.tenant?.user) continue;

        const payload = buildPayload(type, {
          pgName:  agr.pg?.name || 'your PG',
          endDate: new Date(agr.endDate).toLocaleDateString('en-IN'),
        });

        const recipients = [agr.tenant.user.toString()];
        if (agr.pg?.owner) recipients.push(agr.pg.owner.toString());

        await notificationService.createAndSend({
          type,
          title: payload.title,
          body:  payload.body,
          data: {
            deepLink:   'pginfo://tenant-home/agreement',
            entityType: 'Agreement',
            entityId:   agr._id.toString(),
          },
          audience:       { type: 'specific', targetUserIds: recipients },
          isTransactional: false,
        });
      }

      logger.info(`[Scheduler] Agreement ${days}d reminders: ${agreements.length} sent`);
    }
  } catch (err) {
    logger.error(`[Scheduler] runAgreementReminders error: ${err.message}`);
  }
}

// ─── Scheduler Startup ────────────────────────────────────────────────────────

function startScheduler() {
  logger.info('[Scheduler] Starting notification scheduler...');

  // Every 1 minute: process scheduled notifications
  cron.schedule('* * * * *', processScheduledNotifications, {
    timezone: 'Asia/Kolkata',
  });

  // Every 5 minutes: poll Expo receipts
  cron.schedule('*/5 * * * *', pollExpoReceipts, {
    timezone: 'Asia/Kolkata',
  });

  // Every 15 minutes: retry failed receipts
  cron.schedule('*/15 * * * *', retryFailedReceipts, {
    timezone: 'Asia/Kolkata',
  });

  // Daily at 9 AM IST: rent reminders and overdue
  cron.schedule('0 9 * * *', runRentReminders, {
    timezone: 'Asia/Kolkata',
  });

  // Daily at 10 AM IST: agreement expiry reminders
  cron.schedule('0 10 * * *', runAgreementReminders, {
    timezone: 'Asia/Kolkata',
  });

  logger.info('[Scheduler] All notification jobs registered ✓');
}

module.exports = {
  startScheduler,
  // Export individual jobs for testing
  processScheduledNotifications,
  pollExpoReceipts,
  retryFailedReceipts,
  runRentReminders,
  runAgreementReminders,
};

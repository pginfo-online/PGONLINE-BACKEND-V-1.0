/**
 * BullMQ Workers — Background Job Processors
 *
 * Registers all workers for the PG Management queue system.
 * Called once from server.js after DB + Redis connections are established.
 *
 * Workers:
 *  1. Rent Generation     — Generate monthly rent records for tenants
 *  2. Rent Reminders      — Send WhatsApp/email/push rent reminders
 *  3. Receipt Generation  — Generate PDF receipts and upload to Cloudinary
 *  4. Notifications       — Multi-channel notification dispatch
 *  5. Payment Links       — Create Razorpay payment links
 */

const { QUEUE_NAMES, registerWorker, scheduleRepeatingJob, getQueue } = require('../../config/queue');
const { logger } = require('../../utils/logger');

// ─── Services ─────────────────────────────────────────────────────────────────
const rentService     = require('../manage/rent.service');
const receiptService  = require('../manage/receipt.service');
const razorpayService = require('../manage/razorpay.service');
const whatsappService = require('../notification/whatsapp.service');
const emailService    = require('../notification/email.service');
const notificationTrigger = require('../notification/notification.trigger');

// ─── Models ───────────────────────────────────────────────────────────────────
const Tenant     = require('../../models/Tenant.model');
const RentRecord = require('../../models/RentRecord.model');
const PG         = require('../../models/PG.model');
const User       = require('../../models/User.model');
const Bed        = require('../../models/Bed.model');

// ─── Worker 1: Rent Generation ────────────────────────────────────────────────
const processRentGeneration = async (job) => {
  const { pgId, ownerId, month, year, dueDayOfMonth } = job.data;
  logger.info(`[RentGenWorker] Generating rent for PG ${pgId} — ${month}/${year}`);

  const result = await rentService.generateMonthlyRent(pgId, ownerId, month, year, dueDayOfMonth);
  logger.info(`[RentGenWorker] PG ${pgId}: ${result.created} created, ${result.skipped} skipped`);

  // Trigger notifications for new records
  if (result.records && result.records.length > 0) {
    for (const rec of result.records) {
      notificationTrigger.onRentGenerated(rec).catch(() => {});
    }
  }

  return result;
};

// ─── Worker 2: Rent Reminders ─────────────────────────────────────────────────
const processRentReminder = async (job) => {
  const { rentRecordId, channel, reminderType, sentBy } = job.data;
  logger.info(`[ReminderWorker] Sending ${reminderType} via ${channel} for record ${rentRecordId}`);

  const record = await RentRecord.findById(rentRecordId)
    .populate('tenant', 'name phone email user')
    .populate('room', 'roomNumber')
    .populate('pg', 'name');

  if (!record) throw new Error(`Rent record ${rentRecordId} not found`);
  if (['paid', 'waived'].includes(record.status)) {
    logger.info(`[ReminderWorker] Skipping — record already ${record.status}`);
    return { skipped: true, reason: `Already ${record.status}` };
  }

  const tenant = record.tenant;
  if (!tenant) throw new Error('Tenant not found on rent record');

  const dueDate = record.dueDate
    ? record.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'N/A';

  const now = new Date();
  const daysOverdue = record.dueDate ? Math.max(0, Math.floor((now - record.dueDate) / 86400000)) : 0;

  const reminderData = {
    tenantName:  tenant.name,
    pgName:      record.pg?.name || '',
    roomNumber:  record.room?.roomNumber || '',
    amount:      record.totalAmount - record.paidAmount,
    dueDate,
    daysOverdue,
    pgNameMgmt:  record.pg?.name || '',
  };

  let result = { success: false, error: 'Unknown channel' };

  // ── WhatsApp channel ──────────────────────────────────────────────────────
  if (channel === 'whatsapp' && tenant.phone) {
    if (reminderType === 'overdue') {
      result = await whatsappService.sendRentOverdue(tenant.phone, reminderData);
    } else {
      result = await whatsappService.sendRentReminder(tenant.phone, reminderData);
    }
  }

  // ── Email channel ─────────────────────────────────────────────────────────
  if (channel === 'email' && tenant.email) {
    result = await emailService.sendRentReminderEmail(tenant.email, reminderData);
  }

  // ── Push channel ──────────────────────────────────────────────────────────
  if (channel === 'push' && tenant.user) {
    const payload = reminderType === 'overdue'
      ? { title: '⚠️ Rent Overdue', body: `₹${reminderData.amount} overdue by ${daysOverdue} days` }
      : { title: '💰 Rent Due Reminder', body: `₹${reminderData.amount} due on ${dueDate}` };

    try {
      const { createAndSend } = require('../notification/notification.service');
      await createAndSend({
        type: 'rent_reminder',
        title: payload.title,
        body: payload.body,
        data: { deepLink: `pginfo://rent/${rentRecordId}`, entityType: 'RentRecord', entityId: rentRecordId },
        audience: { type: 'specific', targetUserIds: [tenant.user] },
        isTransactional: true,
      });
      result = { success: true, messageId: `push-${Date.now()}` };
    } catch (err) {
      result = { success: false, error: err.message };
    }
  }

  // ── Track reminder on rent record ─────────────────────────────────────────
  await RentRecord.findByIdAndUpdate(rentRecordId, {
    $push: {
      remindersSent: {
        channel,
        type:      reminderType || 'due_reminder',
        sentAt:    new Date(),
        status:    result.success ? 'sent' : 'failed',
        sentBy:    sentBy || null,
        messageId: result.messageId || null,
        error:     result.error || null,
      },
    },
  });

  if (!result.success) {
    throw new Error(`Reminder failed: ${result.error}`);
  }

  return result;
};

// ─── Worker 3: Receipt Generation ─────────────────────────────────────────────
const processReceiptGeneration = async (job) => {
  const { rentRecordId, paymentId } = job.data;
  logger.info(`[ReceiptWorker] Generating receipt for rent record ${rentRecordId}`);

  const record = await RentRecord.findById(rentRecordId)
    .populate('tenant', 'name phone email user')
    .populate('pg', 'name address')
    .populate('room', 'roomNumber');

  if (!record) throw new Error(`Rent record ${rentRecordId} not found`);

  const owner = await User.findById(record.owner).select('name');

  const receiptResult = await receiptService.generateAndStoreReceipt({
    paymentId,
    tenantName:    record.tenant?.name || 'Tenant',
    tenantPhone:   record.tenant?.phone || '',
    pgName:        record.pg?.name || '',
    pgAddress:     record.pg?.address || '',
    ownerName:     owner?.name || '',
    billingMonth:  record.billingMonth,
    billingYear:   record.billingYear,
    rentAmount:    record.rentAmount,
    paidAmount:    record.paidAmount,
    paymentMethod: 'cash',
    reference:     record._id.toString(),
  });

  if (receiptResult?.receiptUrl) {
    record.invoiceUrl = receiptResult.receiptUrl;
    record.invoiceNumber = receiptResult.receiptNumber;
    await record.save();

    // Send receipt via email if tenant has email
    if (record.tenant?.email) {
      emailService.sendReceiptEmail(record.tenant.email, {
        tenantName:   record.tenant.name,
        receiptUrl:   receiptResult.receiptUrl,
        amount:       record.paidAmount,
        billingMonth: record.billingMonth,
        billingYear:  record.billingYear,
      }).catch((err) => logger.error(`[ReceiptWorker] Email send failed: ${err.message}`));
    }

    // Notify tenant via push
    if (record.tenant?.user) {
      notificationTrigger.onReceiptGenerated({
        _id: record._id,
        receiptUrl: receiptResult.receiptUrl,
        amount: record.paidAmount,
        tenant: record.tenant._id,
        user: record.tenant.user,
      }).catch(() => {});
    }
  }

  return receiptResult;
};

// ─── Worker 4: Multi-Channel Notifications ────────────────────────────────────
const processNotification = async (job) => {
  const { type, channel, recipientId, recipientPhone, recipientEmail, data } = job.data;
  logger.info(`[NotifWorker] Sending ${type} via ${channel} to ${recipientId || recipientPhone}`);

  let result = { success: false };

  switch (channel) {
    case 'whatsapp':
      if (recipientPhone && data.templateName) {
        result = await whatsappService.sendTemplate(
          recipientPhone, data.templateName, 'en', data.bodyParams || []
        );
      }
      break;

    case 'email':
      if (recipientEmail) {
        result = await emailService.sendEmail({
          to:      recipientEmail,
          subject: data.subject,
          html:    data.html,
        });
      }
      break;

    case 'push':
      if (recipientId) {
        const { createAndSend } = require('../notification/notification.service');
        await createAndSend({
          type:  data.notificationType || type,
          title: data.title,
          body:  data.body,
          data:  data.pushData || {},
          audience: { type: 'specific', targetUserIds: [recipientId] },
          isTransactional: true,
        });
        result = { success: true };
      }
      break;
  }

  if (!result.success) {
    throw new Error(`Notification failed: ${result.error || 'Unknown error'}`);
  }

  return result;
};

// ─── Worker 5: Payment Link Generation ────────────────────────────────────────
const processPaymentLink = async (job) => {
  const { rentRecordId } = job.data;
  logger.info(`[PayLinkWorker] Creating payment link for record ${rentRecordId}`);

  const record = await RentRecord.findById(rentRecordId)
    .populate('tenant', 'name phone email')
    .populate('pg', 'name');

  if (!record) throw new Error(`Rent record ${rentRecordId} not found`);

  const outstanding = record.totalAmount - record.paidAmount;
  if (outstanding <= 0) {
    return { skipped: true, reason: 'No outstanding amount' };
  }

  const razorpay = razorpayService;
  // Use Razorpay Payment Links API
  const linkData = {
    amount:      Math.round(outstanding * 100), // paise
    currency:    'INR',
    description: `Rent for ${record.pg?.name || 'PG'} — ${record.billingMonth}/${record.billingYear}`,
    customer: {
      name:    record.tenant?.name || 'Tenant',
      contact: record.tenant?.phone || '',
      email:   record.tenant?.email || undefined,
    },
    notify: {
      sms:   !!record.tenant?.phone,
      email: !!record.tenant?.email,
    },
    reminder_enable: true,
    notes: {
      rentRecordId: rentRecordId,
      pgId:         record.pg?._id?.toString() || '',
      tenantId:     record.tenant?._id?.toString() || '',
    },
    callback_url: `${process.env.FRONTEND_URL || 'https://pginfo.online'}/payment/success`,
    callback_method: 'get',
  };

  // Note: This requires Razorpay SDK to support payment links
  // For now, store the link data — actual implementation depends on Razorpay SDK version
  try {
    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const paymentLink = await rzp.paymentLink.create(linkData);

    record.paymentLink   = paymentLink.short_url;
    record.paymentLinkId = paymentLink.id;
    await record.save();

    logger.info(`[PayLinkWorker] Payment link created: ${paymentLink.short_url}`);

    // Send payment link via WhatsApp
    if (record.tenant?.phone) {
      whatsappService.sendRentReceipt(record.tenant.phone, {
        bodyParams: [
          record.tenant.name,
          record.pg?.name || 'PG',
          String(outstanding),
          paymentLink.short_url,
        ],
      }).catch((err) => logger.error(`[PayLinkWorker] WhatsApp send failed: ${err.message}`));
    }

    return { paymentLink: paymentLink.short_url, paymentLinkId: paymentLink.id };
  } catch (err) {
    logger.error(`[PayLinkWorker] Razorpay payment link creation failed: ${err.message}`);
    throw err;
  }
};

// ─── Daily Auto-Rent Generation (Scheduled Job) ──────────────────────────────
const processAutoRentGeneration = async (job) => {
  logger.info('[AutoRentGen] Running daily auto-rent generation...');

  const today = new Date();
  const currentDay   = today.getDate();
  const currentMonth = today.getMonth() + 1;
  const currentYear  = today.getFullYear();

  // Find all active tenants whose billingDate matches today
  const tenants = await Tenant.find({
    status: 'active',
    billingDate: currentDay,
  }).select('_id pg owner monthlyRent room bed billingDate').lean();

  if (tenants.length === 0) {
    logger.info('[AutoRentGen] No tenants with billing date today');
    return { processed: 0 };
  }

  let created = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    try {
      const existing = await RentRecord.findOne({
        tenant:       tenant._id,
        billingMonth: currentMonth,
        billingYear:  currentYear,
      });

      if (existing) {
        skipped++;
        continue;
      }

      const dueDate = new Date(currentYear, currentMonth - 1, tenant.billingDate || 1);

      await RentRecord.create({
        tenant:       tenant._id,
        pg:           tenant.pg,
        owner:        tenant.owner,
        room:         tenant.room,
        bed:          tenant.bed,
        billingMonth: currentMonth,
        billingYear:  currentYear,
        rentAmount:   tenant.monthlyRent,
        totalAmount:  tenant.monthlyRent,
        paidAmount:   0,
        dueDate,
        billingPeriodStart: dueDate,
        billingPeriodEnd:   new Date(currentYear, currentMonth, tenant.billingDate || 1),
        status:       'pending',
      });

      created++;
    } catch (err) {
      if (err.code === 11000) {
        skipped++;
      } else {
        logger.error(`[AutoRentGen] Failed for tenant ${tenant._id}: ${err.message}`);
      }
    }
  }

  logger.info(`[AutoRentGen] Done: ${created} created, ${skipped} skipped out of ${tenants.length}`);
  return { created, skipped, total: tenants.length };
};

// ─── Daily Overdue Marking ───────────────────────────────────────────────────
const processOverdueMarking = async (job) => {
  logger.info('[OverdueMarker] Running daily overdue marking...');
  const count = await rentService.markOverdueRecords();
  logger.info(`[OverdueMarker] Marked ${count} records as overdue`);
  return { markedOverdue: count };
};

// ─── Register All Workers ─────────────────────────────────────────────────────
const initializeWorkers = async () => {
  logger.info('🚀 Initializing BullMQ workers...');

  registerWorker(QUEUE_NAMES.RENT_GENERATION, processRentGeneration, { concurrency: 3 });
  registerWorker(QUEUE_NAMES.RENT_REMINDERS, processRentReminder, { concurrency: 10 });
  registerWorker(QUEUE_NAMES.RECEIPT_GENERATION, processReceiptGeneration, { concurrency: 5 });
  registerWorker(QUEUE_NAMES.NOTIFICATIONS, processNotification, { concurrency: 10 });
  registerWorker(QUEUE_NAMES.PAYMENT_LINKS, processPaymentLink, { concurrency: 3 });

  // ── Schedule repeating jobs ───────────────────────────────────────────────
  // Daily auto-rent generation at 6:00 AM IST
  const rentGenQueue = getQueue(QUEUE_NAMES.RENT_GENERATION);
  await rentGenQueue.add('auto-rent-daily', {}, {
    repeat: { pattern: '0 6 * * *' }, // 6 AM daily
    jobId: 'auto-rent-daily',
  });

  // Daily overdue marking at 9:00 AM IST
  await rentGenQueue.add('overdue-marking-daily', {}, {
    repeat: { pattern: '0 9 * * *' }, // 9 AM daily
    jobId: 'overdue-marking-daily',
  });

  // Register auto-rent and overdue workers as part of the rent generation queue
  // They share the queue but use different job names
  logger.info('✅ All BullMQ workers initialized and repeating jobs scheduled');
};

module.exports = {
  initializeWorkers,
  processRentGeneration,
  processRentReminder,
  processReceiptGeneration,
  processNotification,
  processPaymentLink,
  processAutoRentGeneration,
  processOverdueMarking,
};

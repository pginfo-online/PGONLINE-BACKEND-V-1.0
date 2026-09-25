const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const RentRecord  = require('../../models/RentRecord.model');
const Tenant      = require('../../models/Tenant.model');
const PG          = require('../../models/PG.model');
const User        = require('../../models/User.model');
const rentService = require('../../services/manage/rent.service');
const receiptService = require('../../services/manage/receipt.service');
const razorpayService = require('../../services/manage/razorpay.service');
const whatsappService = require('../../services/notification/whatsapp.service');
const emailService = require('../../services/notification/email.service');
const notificationTrigger = require('../../services/notification/notification.trigger');
const { logger } = require('../../utils/logger');

// ─── Month Parsing Helper ───────────────────────────────────────────────────
const parseMonthNumber = (m) => {
  if (!m) return null;
  const num = parseInt(m, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  const MONTH_MAP = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
    sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  };
  const lower = String(m).trim().toLowerCase();
  return MONTH_MAP[lower] || null;
};

// ─── Generate Monthly Rent ────────────────────────────────────────────────────
exports.generateRent = asyncHandler(async (req, res) => {
  const { pgId }  = req.params;
  const ownerId   = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const rawMonth = req.body.month;
  const rawYear = req.body.year;
  const month = parseMonthNumber(rawMonth);
  const year = parseInt(rawYear, 10);
  const dueDayOfMonth = parseInt(req.body.dueDayOfMonth, 10) || pg.rentSettings?.dueDayOfMonth || 5;

  if (!month || !year) return errorResponse(res, 'Valid month (1-12) and year are required', 400);

  const result = await rentService.generateMonthlyRent(pgId, ownerId, month, year, dueDayOfMonth);

  // Notify tenants for newly created rent records
  if (result.records && result.records.length > 0) {
    for (const rec of result.records) {
      notificationTrigger.onRentGenerated(rec).catch(() => {});
    }
  }

  return successResponse(res, `Rent generated: ${result.created} created, ${result.skipped} skipped`, result);
});

// ─── List Rent Records (with filters & pagination) ────────────────────────────
exports.getRentRecords = asyncHandler(async (req, res) => {
  const { pgId }  = req.params;
  const ownerId   = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const skip  = (page - 1) * limit;

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.status) filter.status = req.query.status;

  const filterMonth = parseMonthNumber(req.query.month);
  if (filterMonth) filter.billingMonth = filterMonth;
  if (req.query.year) {
    const y = parseInt(req.query.year, 10);
    if (!isNaN(y)) filter.billingYear = y;
  }

  const [records, total] = await Promise.all([
    RentRecord.find(filter)
      .populate('tenant', 'name phone email monthlyRent joinDate status profilePhoto')
      .populate('room',   'roomNumber shareType floorLabel')
      .populate('bed',    'bedLabel status')
      .sort({ dueDate: -1 })
      .skip(skip)
      .limit(limit),
    RentRecord.countDocuments(filter),
  ]);

  const summary = await rentService.getRentSummary(
    pgId,
    filterMonth,
    req.query.year ? parseInt(req.query.year, 10) : null
  );

  return res.status(200).json({
    success: true,
    message: 'Rent records fetched',
    data: records,
    summary,
    pagination: {
      page, limit, total, pages: Math.ceil(total / limit),
    },
  });
});

// ─── Get Single Rent Record Detail ───────────────────────────────────────────
exports.getRentRecord = asyncHandler(async (req, res) => {
  const record = await RentRecord.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('tenant', 'name phone email monthlyRent joinDate status profilePhoto aadhaar rentCycle billingDate')
    .populate('room',   'roomNumber shareType floorLabel hasMeter')
    .populate('bed',    'bedLabel status')
    .populate('pg',     'name address city phone');

  if (!record) return errorResponse(res, 'Rent record not found or access denied', 404);

  return successResponse(res, 'Rent record fetched', record);
});

// ─── Update Rent Record ──────────────────────────────────────────────────────
exports.updateRentRecord = asyncHandler(async (req, res) => {
  try {
    const updated = await rentService.updateRentRecord(req.params.id, req.user._id, req.body);
    return successResponse(res, 'Rent record updated successfully', updated);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

// ─── Delete Rent Record ──────────────────────────────────────────────────────
exports.deleteRentRecord = asyncHandler(async (req, res) => {
  try {
    const result = await rentService.deleteRentRecord(req.params.id, req.user._id);
    return successResponse(res, result.message);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

// ─── Get Rent Records for a Tenant ────────────────────────────────────────────
exports.getTenantRentRecords = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findOne({ _id: req.params.tenantId, owner: req.user._id });
  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);

  const records = await RentRecord.find({ tenant: tenant._id })
    .sort({ billingYear: -1, billingMonth: -1 });

  return successResponse(res, 'Tenant rent records fetched', records);
});

// ─── Mark Rent as Paid (manual) ───────────────────────────────────────────────
exports.markRentPaid = asyncHandler(async (req, res) => {
  const record = await RentRecord.findOne({ _id: req.params.id, owner: req.user._id });
  if (!record) return errorResponse(res, 'Rent record not found or access denied', 404);

  const amount = Number(req.body.amount || req.body.amountPaid);
  const method = req.body.method || req.body.paymentMethod || 'cash';
  const reference = req.body.reference || req.body.transactionRef || '';
  const notes = req.body.notes || req.body.remarks || '';

  if (!amount || amount <= 0) return errorResponse(res, 'Valid payment amount is required', 400);

  const updated = await rentService.recordPayment(record._id, amount, { method, reference, notes });

  // Async receipt generation & tenant notification
  (async () => {
    try {
      const [tenant, pg, owner] = await Promise.all([
        Tenant.findById(record.tenant),
        PG.findById(record.pg),
        User.findById(record.owner),
      ]);

      const receiptResult = await receiptService.generateAndStoreReceipt({
        tenantName:    tenant?.name || 'Tenant',
        tenantPhone:   tenant?.phone || '',
        pgName:        pg?.name || '',
        pgAddress:     pg?.address || '',
        ownerName:     owner?.name || '',
        billingMonth:  record.billingMonth,
        billingYear:   record.billingYear,
        rentAmount:    record.rentAmount,
        paidAmount:    amount,
        paymentMethod: method || 'cash',
        reference:     reference || '',
      });

      if (receiptResult?.receiptUrl) {
        record.invoiceUrl = receiptResult.receiptUrl;
        record.invoiceNumber = receiptResult.receiptNumber;
        await record.save();

        // Send confirmation via WhatsApp if phone is available
        if (tenant?.phone) {
          whatsappService.sendPaymentConfirmation(tenant.phone, {
            tenantName:    tenant.name,
            amount:        String(amount),
            month:         String(record.billingMonth),
            year:          String(record.billingYear),
            receiptNumber: receiptResult.receiptNumber,
            pgName:        pg?.name || 'PG',
          }).catch((e) => logger.warn(`[WhatsApp] Payment confirmation failed: ${e.message}`));
        }

        // Send confirmation via Email if email is available
        if (tenant?.email) {
          emailService.sendPaymentConfirmationEmail(tenant.email, {
            tenantName:    tenant.name,
            amount,
            billingMonth:  record.billingMonth,
            billingYear:   record.billingYear,
            receiptNumber: receiptResult.receiptNumber,
            receiptUrl:    receiptResult.receiptUrl,
            pgName:        pg?.name || 'PG',
          }).catch((e) => logger.warn(`[Email] Payment confirmation failed: ${e.message}`));
        }

        if (tenant?.user) {
          notificationTrigger.onReceiptGenerated({
            _id: record._id,
            receiptUrl: receiptResult.receiptUrl,
            amount,
            tenant: tenant._id,
            user: tenant.user,
          }).catch(() => {});
        }
      }
    } catch (e) {
      logger.error(`[MarkPaid] Receipt generation error: ${e.message}`);
    }
  })();

  return successResponse(res, 'Payment recorded', updated);
});

// ─── Send Rent Reminder (WhatsApp, Email, Push) ──────────────────────────────
exports.sendRentReminder = asyncHandler(async (req, res) => {
  const { channel = 'whatsapp', type = 'due_reminder' } = req.body;
  const record = await RentRecord.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('tenant')
    .populate('pg');

  if (!record) return errorResponse(res, 'Rent record not found or access denied', 404);
  if (record.status === 'paid') return errorResponse(res, 'Rent is already paid', 400);

  const tenant = record.tenant;
  if (!tenant) return errorResponse(res, 'Linked tenant not found', 404);

  const outstanding = record.totalAmount - record.paidAmount;
  const dueDateStr = new Date(record.dueDate).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = MONTH_NAMES[(record.billingMonth || 1) - 1];

  let deliveryStatus = 'sent';
  let deliveryError = null;
  let messageId = null;

  // 1. WhatsApp Delivery
  if ((channel === 'whatsapp' || channel === 'all') && tenant.phone) {
    try {
      const waResult = await whatsappService.sendRentReminder(tenant.phone, {
        tenantName:  tenant.name,
        amount:      String(outstanding),
        dueDate:     dueDateStr,
        paymentLink: record.paymentLink || 'N/A',
        pgName:      record.pg?.name || 'PG',
      });
      messageId = waResult.messageId || null;
    } catch (err) {
      deliveryStatus = 'failed';
      deliveryError = `WhatsApp: ${err.message}`;
      logger.warn(`[Reminder] WhatsApp send failed: ${err.message}`);
    }
  }

  // 2. Email Delivery
  if ((channel === 'email' || channel === 'all') && tenant.email) {
    try {
      await emailService.sendRentReminderEmail(tenant.email, {
        tenantName:   tenant.name,
        amount:       outstanding,
        dueDate:      dueDateStr,
        billingMonth: record.billingMonth,
        billingYear:  record.billingYear,
        paymentLink:  record.paymentLink || null,
        pgName:       record.pg?.name || 'PG',
      });
    } catch (err) {
      if (deliveryStatus !== 'failed') deliveryStatus = 'partial_failure';
      deliveryError = (deliveryError ? `${deliveryError} | ` : '') + `Email: ${err.message}`;
      logger.warn(`[Reminder] Email send failed: ${err.message}`);
    }
  }

  // 3. In-App Notification Delivery
  if (tenant.user) {
    try {
      notificationTrigger.onRentReminder({
        tenant:  tenant._id,
        user:    tenant.user,
        amount:  outstanding,
        dueDate: dueDateStr,
        month:   monthName,
      }).catch(() => {});
    } catch (_) {}
  }

  // Record audit trail in remindersSent
  await rentService.recordReminderSent(record._id, {
    channel,
    type,
    status: deliveryStatus,
    sentBy: req.user._id,
    messageId,
    error: deliveryError,
  });

  return successResponse(res, `Reminder sent via ${channel}`, {
    channel,
    status: deliveryStatus,
    error: deliveryError,
  });
});

// ─── Generate Razorpay Payment Link for Rent Record ───────────────────────────
exports.createPaymentLink = asyncHandler(async (req, res) => {
  const record = await RentRecord.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('tenant')
    .populate('pg');

  if (!record) return errorResponse(res, 'Rent record not found or access denied', 404);
  if (record.status === 'paid' || record.status === 'waived') {
    return errorResponse(res, `Rent record is already ${record.status}`, 400);
  }

  const outstanding = record.totalAmount - record.paidAmount;
  if (outstanding <= 0) return errorResponse(res, 'No outstanding amount on this record', 400);

  const tenant = record.tenant;
  const pg = record.pg;

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = MONTH_NAMES[(record.billingMonth || 1) - 1];

  try {
    const paymentLink = await razorpayService.createPaymentLink({
      amount: outstanding * 100, // paise
      description: `Rent for ${monthName} ${record.billingYear} — ${pg?.name || 'PG'}`,
      customer: {
        name:    tenant?.name || 'Tenant',
        email:   tenant?.email || undefined,
        contact: tenant?.phone || undefined,
      },
      notes: {
        rentRecordId: record._id.toString(),
        pgId:         pg?._id?.toString() || '',
        tenantId:     tenant?._id?.toString() || '',
        month:        record.billingMonth,
        year:         record.billingYear,
      },
    });

    // Save payment link details on record
    await rentService.setPaymentLink(record._id, paymentLink.short_url, paymentLink.id);

    return successResponse(res, 'Payment link generated successfully', {
      paymentLink:   paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      amount:        outstanding,
    });
  } catch (err) {
    logger.error(`[PaymentLink] Failed to create Razorpay link: ${err.message}`);
    return errorResponse(res, `Failed to generate payment link: ${err.message}`, 500);
  }
});

// ─── Get Reminder History for Rent Record ─────────────────────────────────────
exports.getReminderHistory = asyncHandler(async (req, res) => {
  const record = await RentRecord.findOne({ _id: req.params.id, owner: req.user._id })
    .select('remindersSent totalAmount paidAmount dueDate billingMonth billingYear')
    .populate('remindersSent.sentBy', 'name');

  if (!record) return errorResponse(res, 'Rent record not found or access denied', 404);

  return successResponse(res, 'Reminder history fetched', record.remindersSent || []);
});

// ─── Property Rent Summary ───────────────────────────────────────────────────
exports.getRentSummary = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const pg = await PG.findOne({ _id: pgId, owner: req.user._id });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const month = parseMonthNumber(req.query.month);
  const year  = req.query.year ? parseInt(req.query.year, 10) : null;

  const summary = await rentService.getRentSummary(pgId, month, year);
  return successResponse(res, 'Rent summary fetched', summary);
});

// ─── Tenant: View Own Rent Records ────────────────────────────────────────────
exports.getMyRentRecords = asyncHandler(async (req, res) => {
  const matchConditions = [{ user: req.user._id }];
  if (req.user.email) {
    matchConditions.push({ email: req.user.email.toLowerCase().trim() });
  }
  if (req.user.phone) {
    const rawPhone = req.user.phone.toString().trim();
    const last10 = rawPhone.replace(/\D/g, '').slice(-10);
    if (last10.length === 10) {
      matchConditions.push({ phone: new RegExp(last10 + '$') });
    } else {
      matchConditions.push({ phone: rawPhone });
    }
  }

  const tenants = await Tenant.find({ $or: matchConditions });
  if (!tenants || tenants.length === 0) return errorResponse(res, 'No tenancy found', 404);

  const tenantIds = tenants.map((t) => t._id);

  const records = await RentRecord.find({ tenant: { $in: tenantIds } })
    .populate('room', 'roomNumber shareType floorLabel')
    .populate('pg',   'name address phone')
    .sort({ billingYear: -1, billingMonth: -1 })
    .limit(24);

  const activeTenant = tenants.find((t) => ['active', 'notice', 'pending'].includes(t.status)) || tenants[0];
  const summary = activeTenant?.pg ? await rentService.getRentSummary(activeTenant.pg) : null;

  return successResponse(res, 'Your rent records fetched', { records, summary });
});

// ─── Get Receipt PDF URL for a Rent Record ─────────────────────────────────────
exports.getReceipt = asyncHandler(async (req, res) => {
  const record = await RentRecord.findById(req.params.id)
    .populate('tenant')
    .populate('pg');

  if (!record) return errorResponse(res, 'Rent record not found', 404);

  // Check authorization: must be owner of PG or linked tenant
  const isOwner = record.owner.toString() === req.user._id.toString();
  const isTenant = record.tenant?.user && record.tenant.user.toString() === req.user._id.toString();

  if (!isOwner && !isTenant) {
    return errorResponse(res, 'Not authorized to access this receipt', 403);
  }

  if (record.invoiceUrl) {
    return successResponse(res, 'Receipt URL fetched', { receiptUrl: record.invoiceUrl, invoiceNumber: record.invoiceNumber });
  }

  // Generate on-demand if paid but receiptUrl missing
  if (record.status === 'paid' || record.paidAmount > 0) {
    const owner = await User.findById(record.owner);
    const receiptResult = await receiptService.generateAndStoreReceipt({
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
      return successResponse(res, 'Receipt generated', { receiptUrl: receiptResult.receiptUrl, invoiceNumber: receiptResult.receiptNumber });
    }
  }

  return errorResponse(res, 'Receipt is not available yet', 404);
});

// ─── Get Rent Settings for a PG ──────────────────────────────────────────────
exports.getRentSettings = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const pg = await PG.findOne({ _id: pgId, owner: req.user._id }).select('name rentSettings');
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const defaultSettings = {
    dueDayOfMonth: 5,
    lateFeePerDay: 50,
    autoRemindWhatsApp: true,
    autoRemindEmail: false,
    remindDaysBefore: 2,
  };

  const settings = pg.rentSettings
    ? { ...defaultSettings, ...(pg.rentSettings.toObject ? pg.rentSettings.toObject() : pg.rentSettings) }
    : defaultSettings;

  return successResponse(res, 'Rent settings fetched', settings);
});

// ─── Update Rent Settings for a PG ───────────────────────────────────────────
exports.updateRentSettings = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const pg = await PG.findOne({ _id: pgId, owner: req.user._id });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const {
    dueDayOfMonth,
    lateFeePerDay,
    autoRemindWhatsApp,
    autoRemindEmail,
    remindDaysBefore,
  } = req.body;

  const updateFields = {};
  if (dueDayOfMonth !== undefined) {
    updateFields['rentSettings.dueDayOfMonth'] = Math.min(28, Math.max(1, parseInt(dueDayOfMonth, 10) || 5));
  }
  if (lateFeePerDay !== undefined) {
    updateFields['rentSettings.lateFeePerDay'] = Math.max(0, parseFloat(lateFeePerDay) || 0);
  }
  if (autoRemindWhatsApp !== undefined) {
    updateFields['rentSettings.autoRemindWhatsApp'] = Boolean(autoRemindWhatsApp);
  }
  if (autoRemindEmail !== undefined) {
    updateFields['rentSettings.autoRemindEmail'] = Boolean(autoRemindEmail);
  }
  if (remindDaysBefore !== undefined) {
    updateFields['rentSettings.remindDaysBefore'] = Math.min(15, Math.max(1, parseInt(remindDaysBefore, 10) || 2));
  }

  const updatedPg = await PG.findByIdAndUpdate(
    pgId,
    { $set: updateFields },
    { new: true }
  ).select('rentSettings');

  const defaultSettings = {
    dueDayOfMonth: 5,
    lateFeePerDay: 50,
    autoRemindWhatsApp: true,
    autoRemindEmail: false,
    remindDaysBefore: 2,
  };

  const settings = updatedPg?.rentSettings
    ? { ...defaultSettings, ...(updatedPg.rentSettings.toObject ? updatedPg.rentSettings.toObject() : updatedPg.rentSettings) }
    : defaultSettings;

  return successResponse(res, 'Rent settings updated successfully', settings);
});

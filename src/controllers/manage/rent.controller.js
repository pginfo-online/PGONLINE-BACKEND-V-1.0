const asyncHandler   = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const RentRecord  = require('../../models/RentRecord.model');
const Tenant      = require('../../models/Tenant.model');
const PG          = require('../../models/PG.model');
const User        = require('../../models/User.model');
const Payment     = require('../../models/Payment.model');
const rentService = require('../../services/manage/rent.service');
const receiptService = require('../../services/manage/receipt.service');
const notificationTrigger = require('../../services/notification/notification.trigger');

// ─── Generate Monthly Rent ────────────────────────────────────────────────────
exports.generateRent = asyncHandler(async (req, res) => {
  const { pgId }  = req.params;
  const ownerId   = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const { month, year, dueDayOfMonth } = req.body;
  if (!month || !year) return errorResponse(res, 'month and year are required', 400);

  const result = await rentService.generateMonthlyRent(pgId, ownerId, month, year, dueDayOfMonth || 5);
  // Notify tenants for each created rent record
  if (result.records && result.records.length > 0) {
    result.records.forEach(rec => notificationTrigger.onRentGenerated(rec).catch(() => {}));
  }
  return successResponse(res, `Rent generated: ${result.created} created, ${result.skipped} skipped`, result);
});

// ─── List Rent Records ────────────────────────────────────────────────────────
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
  if (req.query.month)  filter.billingMonth = parseInt(req.query.month);
  if (req.query.year)   filter.billingYear  = parseInt(req.query.year);

  const [records, total] = await Promise.all([
    RentRecord.find(filter)
      .populate('tenant', 'name phone email')
      .populate('room',   'roomNumber')
      .populate('bed',    'bedLabel')
      .sort({ dueDate: -1 })
      .skip(skip)
      .limit(limit),
    RentRecord.countDocuments(filter),
  ]);

  const summary = await rentService.getRentSummary(
    pgId,
    req.query.month  ? parseInt(req.query.month)  : null,
    req.query.year   ? parseInt(req.query.year)   : null
  );

  return paginatedResponse(res, 'Rent records fetched', records, {
    page, limit, total, pages: Math.ceil(total / limit), summary,
  });
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

  const { amount, method, reference, notes } = req.body;
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
      console.error('[MarkPaid] Receipt generation error:', e.message);
    }
  })();

  return successResponse(res, 'Payment recorded', updated);
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

  const tenants = await Tenant.find({
    $or: matchConditions,
  });
  if (!tenants || tenants.length === 0) return errorResponse(res, 'No tenancy found', 404);

  const tenantIds = tenants.map((t) => t._id);

  const records = await RentRecord.find({ tenant: { $in: tenantIds } })
    .sort({ billingYear: -1, billingMonth: -1 })
    .limit(24); // last 2 years

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


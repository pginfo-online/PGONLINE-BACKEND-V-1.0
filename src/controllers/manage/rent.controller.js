const asyncHandler   = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const RentRecord  = require('../../models/RentRecord.model');
const Tenant      = require('../../models/Tenant.model');
const PG          = require('../../models/PG.model');
const rentService = require('../../services/manage/rent.service');
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

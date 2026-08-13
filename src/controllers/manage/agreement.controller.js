const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const Agreement = require('../../models/Agreement.model');
const Tenant    = require('../../models/Tenant.model');
const PG        = require('../../models/PG.model');
const agreementService = require('../../services/manage/agreement.service');

// ─── Create Agreement ─────────────────────────────────────────────────────────
exports.createAgreement = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId }).populate('owner', 'name email phone');
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const tenant = await Tenant.findOne({ _id: req.body.tenantId, pg: pgId, owner: ownerId });
  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);

  const agreementNumber = await agreementService.generateAgreementNumber();

  const agreement = await Agreement.create({
    tenant:           tenant._id,
    pg:               pgId,
    owner:            ownerId,
    building:         tenant.building,
    room:             tenant.room,
    bed:              tenant.bed,
    agreementNumber,
    startDate:        req.body.startDate,
    endDate:          req.body.endDate,
    monthlyRent:      req.body.monthlyRent || tenant.monthlyRent,
    securityDeposit:  req.body.securityDeposit || tenant.securityDeposit,
    noticePeriodDays: req.body.noticePeriodDays || tenant.noticePeriodDays,
    rentDueDay:       req.body.rentDueDay || 1,
    terms:            req.body.terms,
    rules:            req.body.rules || {},
    status:           'active',
  });

  // Generate PDF in background & attach Cloudinary URL
  try {
    const pdfData = await agreementService.generateAgreementPDF(agreement, tenant, pg);
    agreement.documentUrl      = pdfData.url;
    agreement.documentPublicId = pdfData.publicId;
    await agreement.save();
  } catch (pdfErr) {
    console.error('Agreement PDF generation error:', pdfErr);
    // Non-blocking for creation flow, owner can regenerate
  }

  return successResponse(res, 'Agreement created successfully', agreement, 201);
});

// ─── Get Agreements for a PG ──────────────────────────────────────────────────
exports.getAgreements = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.status) filter.status = req.query.status;

  const agreements = await Agreement.find(filter)
    .populate('tenant', 'name phone email')
    .populate('room',   'roomNumber')
    .sort({ createdAt: -1 });

  return successResponse(res, 'Agreements fetched', agreements);
});

// ─── Get Single Agreement ─────────────────────────────────────────────────────
exports.getAgreement = asyncHandler(async (req, res) => {
  const agreement = await Agreement.findById(req.params.id)
    .populate('tenant',   'name phone email aadhaar')
    .populate('pg',       'name address city')
    .populate('building', 'name')
    .populate('room',     'roomNumber shareType')
    .populate('bed',      'bedLabel');

  if (!agreement) return errorResponse(res, 'Agreement not found', 404);

  // Check owner or tenant access
  const isOwner  = agreement.owner.toString() === req.user._id.toString();
  const isTenant = agreement.tenant && agreement.tenant.user && agreement.tenant.user.toString() === req.user._id.toString();

  if (!isOwner && !isTenant && req.user.role !== 'admin') {
    return errorResponse(res, 'Not authorized to view this agreement', 403);
  }

  return successResponse(res, 'Agreement fetched', agreement);
});

// ─── Update Agreement ─────────────────────────────────────────────────────────
exports.updateAgreement = asyncHandler(async (req, res) => {
  const agreement = await Agreement.findOne({ _id: req.params.id, owner: req.user._id });
  if (!agreement) return errorResponse(res, 'Agreement not found or access denied', 404);

  const ALLOWED = ['terms', 'rules', 'status', 'terminationReason'];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) agreement[key] = req.body[key]; });

  if (req.body.status === 'terminated' && !agreement.terminatedAt) {
    agreement.terminatedAt = new Date();
  }

  await agreement.save();
  return successResponse(res, 'Agreement updated', agreement);
});

// ─── Regenerate PDF ───────────────────────────────────────────────────────────
exports.regeneratePDF = asyncHandler(async (req, res) => {
  const agreement = await Agreement.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('tenant')
    .populate({ path: 'pg', populate: { path: 'owner' } });

  if (!agreement) return errorResponse(res, 'Agreement not found or access denied', 404);

  const pdfData = await agreementService.generateAgreementPDF(agreement, agreement.tenant, agreement.pg);
  agreement.documentUrl      = pdfData.url;
  agreement.documentPublicId = pdfData.publicId;
  await agreement.save();

  return successResponse(res, 'Agreement PDF regenerated', agreement);
});

// ─── Direct Stream Agreement PDF ──────────────────────────────────────────────
exports.downloadPDF = asyncHandler(async (req, res) => {
  const agreement = await Agreement.findById(req.params.id)
    .populate('tenant')
    .populate({ path: 'pg', populate: { path: 'owner' } });

  if (!agreement) return errorResponse(res, 'Agreement not found', 404);

  const pdfBuffer = await agreementService.generateAgreementPDFBuffer(
    agreement,
    agreement.tenant,
    agreement.pg
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Agreement-${agreement.agreementNumber}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  return res.send(pdfBuffer);
});


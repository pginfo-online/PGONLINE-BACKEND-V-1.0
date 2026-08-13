const asyncHandler   = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Tenant  = require('../../models/Tenant.model');
const Bed     = require('../../models/Bed.model');
const Room    = require('../../models/Room.model');
const PG      = require('../../models/PG.model');
const User    = require('../../models/User.model');

// ─── List Tenants ─────────────────────────────────────────────────────────────
exports.getTenants = asyncHandler(async (req, res) => {
  const { pgId }  = req.params;
  const ownerId   = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const rx = new RegExp(req.query.search, 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }

  const [tenants, total] = await Promise.all([
    Tenant.find(filter)
      .populate('room', 'roomNumber shareType')
      .populate('bed',  'bedLabel status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Tenant.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Tenants fetched', tenants, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

// ─── Get Single Tenant ────────────────────────────────────────────────────────
exports.getTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('room',     'roomNumber shareType rentPerBed')
    .populate('bed',      'bedLabel status')
    .populate('building', 'name')
    .populate('floor',    'name floorNumber')
    .populate('user',     'name email profilePhoto');

  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);
  return successResponse(res, 'Tenant fetched', tenant);
});

// ─── Add Tenant ───────────────────────────────────────────────────────────────
exports.addTenant = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  // Check for duplicate phone in same PG
  const existing = await Tenant.findOne({ pg: pgId, phone: req.body.phone, status: { $ne: 'vacated' } });
  if (existing) return errorResponse(res, 'A tenant with this phone number already exists in this PG', 409);

  // If a User account exists with this phone or email, link it
  let linkedUser = null;
  const matchConditions = [];
  if (req.body.phone) matchConditions.push({ phone: req.body.phone });
  if (req.body.email) matchConditions.push({ email: req.body.email.toLowerCase().trim() });

  if (matchConditions.length > 0) {
    linkedUser = await User.findOne({ $or: matchConditions });
  }

  const tenant = await Tenant.create({
    pg: pgId,
    owner: ownerId,
    ...req.body,
    user:           linkedUser?._id || null,
    isLinkedToUser: !!linkedUser,
  });

  return successResponse(res, 'Tenant added successfully', tenant, 201);
});

// ─── Update Tenant ────────────────────────────────────────────────────────────
exports.updateTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findOne({ _id: req.params.id, owner: req.user._id });
  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);

  const ALLOWED = [
    'name', 'email', 'phone', 'gender', 'dateOfBirth',
    'emergencyContact', 'foodPreference', 'monthlyRent',
    'securityDeposit', 'depositStatus', 'notes', 'status',
    'expectedLeaveDate', 'noticePeriodDays',
  ];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) tenant[key] = req.body[key]; });

  await tenant.save();
  return successResponse(res, 'Tenant updated', tenant);
});

// ─── Assign Bed to Tenant ─────────────────────────────────────────────────────
exports.assignBed = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { bedId }    = req.body;
  const ownerId      = req.user._id;

  const tenant = await Tenant.findOne({ _id: tenantId, owner: ownerId });
  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);

  const bed = await Bed.findOne({ _id: bedId, owner: ownerId });
  if (!bed) return errorResponse(res, 'Bed not found or access denied', 404);

  if (bed.status !== 'vacant') {
    return errorResponse(res, `Bed is currently ${bed.status} and cannot be assigned`, 400);
  }

  // Unassign current bed if any
  if (tenant.bed) {
    await Bed.findByIdAndUpdate(tenant.bed, {
      status:        'vacant',
      currentTenant: null,
      lastVacatedAt: new Date(),
    });
    // Update old room counters
    if (tenant.room) {
      await Room.findByIdAndUpdate(tenant.room, {
        $inc: { occupiedBeds: -1, vacantBeds: 1 },
      });
    }
  }

  // Assign new bed
  bed.status        = 'occupied';
  bed.currentTenant = tenant._id;
  await bed.save();

  // Update room counters
  await Room.findByIdAndUpdate(bed.room, {
    $inc: { occupiedBeds: 1, vacantBeds: -1 },
  });

  // Update tenant
  tenant.bed      = bed._id;
  tenant.room     = bed.room;
  tenant.floor    = bed.floor;
  tenant.building = bed.building;
  tenant.status   = 'active';
  await tenant.save();

  return successResponse(res, 'Bed assigned to tenant', { tenant, bed });
});

// ─── Vacate Tenant ────────────────────────────────────────────────────────────
exports.vacateTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findOne({ _id: req.params.id, owner: req.user._id });
  if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);

  if (tenant.status === 'vacated') {
    return errorResponse(res, 'Tenant has already vacated', 400);
  }

  // Free the bed
  if (tenant.bed) {
    await Bed.findByIdAndUpdate(tenant.bed, {
      status:        'vacant',
      currentTenant: null,
      lastVacatedAt: new Date(),
    });
    if (tenant.room) {
      await Room.findByIdAndUpdate(tenant.room, {
        $inc: { occupiedBeds: -1, vacantBeds: 1 },
      });
    }
  }

  tenant.status          = 'vacated';
  tenant.actualLeaveDate = req.body.actualLeaveDate || new Date();
  tenant.bed             = null;
  await tenant.save();

  return successResponse(res, 'Tenant vacated successfully', tenant);
});

// ─── Tenant Overview (for logged-in tenant user) ──────────────────────────────
exports.getMyTenancy = asyncHandler(async (req, res) => {
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

  let tenancy = await Tenant.findOne({
    $or: matchConditions,
    status: { $in: ['active', 'notice', 'pending'] },
  })
    .populate('pg',       'name city area address contactPhone photos')
    .populate('building', 'name')
    .populate('floor',    'name floorNumber')
    .populate('room',     'roomNumber shareType amenities')
    .populate('bed',      'bedLabel');

  if (!tenancy) return errorResponse(res, 'No active tenancy found for this account', 404);

  // Auto-link user ID if matched by email/phone
  if (!tenancy.user) {
    tenancy.user = req.user._id;
    tenancy.isLinkedToUser = true;
    await tenancy.save();
  }

  return successResponse(res, 'Tenancy fetched', tenancy);
});

// ─── Search Existing System Users (to become tenants) ───────────────────────
exports.searchExistingTenants = asyncHandler(async (req, res) => {
  const { query } = req.query;

  const filter = {
    role: { $in: ['tenant', 'user'] },
  };

  if (query && query.trim().length > 0) {
    const rx = new RegExp(query.trim(), 'i');
    filter.$or = [
      { name: rx },
      { phone: rx },
      { email: rx },
    ];
  }

  const users = await User.find(filter)
    .select('name email phone profilePhoto createdAt')
    .sort({ createdAt: -1 })
    .limit(15);

  const formatted = users.map((u) => ({
    userId:       u._id,
    name:         u.name,
    email:        u.email || '',
    phone:        u.phone || '',
    profilePhoto: u.profilePhoto || null,
    isRegisteredUser: true,
  }));

  return successResponse(res, 'System users fetched for tenant onboarding', formatted);
});


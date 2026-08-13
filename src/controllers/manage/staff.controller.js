const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Staff = require('../../models/Staff.model');
const PG    = require('../../models/PG.model');

// ─── List Staff ───────────────────────────────────────────────────────────────
exports.getStaff = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.role)   filter.role   = req.query.role;

  const staff = await Staff.find(filter).sort({ createdAt: -1 });
  return successResponse(res, 'Staff fetched', staff);
});

// ─── Get Single Staff ─────────────────────────────────────────────────────────
exports.getStaffMember = asyncHandler(async (req, res) => {
  const staff = await Staff.findOne({ _id: req.params.id, owner: req.user._id });
  if (!staff) return errorResponse(res, 'Staff not found or access denied', 404);
  return successResponse(res, 'Staff member fetched', staff);
});

// ─── Add Staff ────────────────────────────────────────────────────────────────
exports.addStaff = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  // Prevent duplicate active staff with same phone in same PG
  const existing = await Staff.findOne({
    pg: pgId, phone: req.body.phone, status: { $in: ['active', 'on_leave'] },
  });
  if (existing) return errorResponse(res, 'A staff member with this phone already exists in this PG', 409);

  const staff = await Staff.create({ pg: pgId, owner: ownerId, ...req.body });
  return successResponse(res, 'Staff member added', staff, 201);
});

// ─── Update Staff ─────────────────────────────────────────────────────────────
exports.updateStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findOne({ _id: req.params.id, owner: req.user._id });
  if (!staff) return errorResponse(res, 'Staff not found or access denied', 404);

  const ALLOWED = [
    'name', 'phone', 'email', 'gender', 'address', 'role', 'customRole',
    'salary', 'salaryFrequency', 'status', 'joiningDate', 'leavingDate',
    'permissions', 'notes',
  ];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) staff[key] = req.body[key]; });

  await staff.save();
  return successResponse(res, 'Staff member updated', staff);
});

// ─── Update Staff Permissions ─────────────────────────────────────────────────
exports.updatePermissions = asyncHandler(async (req, res) => {
  const staff = await Staff.findOne({ _id: req.params.id, owner: req.user._id });
  if (!staff) return errorResponse(res, 'Staff not found or access denied', 404);

  const PERM_KEYS = [
    'canManageTenants', 'canCollectRent', 'canManageRooms',
    'canViewReports', 'canManageStaff', 'canManageComplaints', 'canHandleMaintenance',
  ];
  PERM_KEYS.forEach((key) => {
    if (req.body[key] !== undefined) staff.permissions[key] = req.body[key];
  });

  await staff.save();
  return successResponse(res, 'Permissions updated', staff.permissions);
});

// ─── Remove Staff ─────────────────────────────────────────────────────────────
exports.removeStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findOne({ _id: req.params.id, owner: req.user._id });
  if (!staff) return errorResponse(res, 'Staff not found or access denied', 404);

  staff.status     = 'terminated';
  staff.leavingDate = new Date();
  await staff.save();

  return successResponse(res, 'Staff member removed (marked as terminated)', staff);
});

const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const PG = require('../models/PG.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const VisitRequest = require('../models/VisitRequest.model');

/**
 * @route GET /api/v1/admin/pgs
 */
const getAllPGs = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const query = status ? { status } : {};
  const skip = (page - 1) * limit;

  const [pgs, total] = await Promise.all([
    PG.find(query)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PG.countDocuments(query),
  ]);

  successResponse(res, 'All PG listings', { pgs, total, page: Number(page), totalPages: Math.ceil(total / limit) });
});

/**
 * @route PUT /api/v1/admin/pgs/:id/approve
 */
const approvePG = asyncHandler(async (req, res) => {
  const pg = await PG.findByIdAndUpdate(
    req.params.id,
    { status: 'approved', rejectionReason: null },
    { new: true }
  ).populate('owner', 'name email');

  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });
  successResponse(res, 'PG approved successfully', { pg });
});

/**
 * @route PUT /api/v1/admin/pgs/:id/reject
 */
const rejectPG = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const pg = await PG.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', rejectionReason: reason || 'Does not meet listing requirements' },
    { new: true }
  );
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });
  successResponse(res, 'PG rejected', { pg });
});

/**
 * @route PUT /api/v1/admin/pgs/:id/verify
 */
const toggleVerify = asyncHandler(async (req, res) => {
  const pg = await PG.findById(req.params.id);
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });

  pg.isVerified = !pg.isVerified;
  await pg.save();
  successResponse(res, `PG ${pg.isVerified ? 'verified' : 'unverified'}`, { pg });
});

/**
 * @route DELETE /api/v1/admin/pgs/:id
 */
const removePG = asyncHandler(async (req, res) => {
  const pg = await PG.findByIdAndDelete(req.params.id);
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });
  successResponse(res, 'PG listing removed');
});

/**
 * @route GET /api/v1/admin/users
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 20 } = req.query;
  const query = role ? { role } : { role: { $ne: 'admin' } };
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    User.countDocuments(query),
  ]);

  successResponse(res, 'Users retrieved', { users, total, page: Number(page), totalPages: Math.ceil(total / limit) });
});

/**
 * @route PUT /api/v1/admin/users/:id/suspend
 */
const suspendUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin') return res.status(403).json({ success: false, message: 'Cannot suspend admin' });

  user.isActive = !user.isActive;
  await user.save();
  successResponse(res, `User ${user.isActive ? 'activated' : 'suspended'}`, { user: user.toSafeObject() });
});

/**
 * @route DELETE /api/v1/admin/users/:id
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.role === 'admin') {
    return res.status(403).json({ success: false, message: 'Cannot delete this user' });
  }
  await User.findByIdAndDelete(req.params.id);
  successResponse(res, 'User deleted');
});

/**
 * @route GET /api/v1/admin/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const [
    totalPGs, approvedPGs, pendingPGs, rejectedPGs, verifiedPGs,
    totalUsers, totalTenants, totalOwners,
    totalLeads, totalVisits,
  ] = await Promise.all([
    PG.countDocuments(),
    PG.countDocuments({ status: 'approved' }),
    PG.countDocuments({ status: 'pending' }),
    PG.countDocuments({ status: 'rejected' }),
    PG.countDocuments({ isVerified: true }),
    User.countDocuments({ role: { $ne: 'admin' } }),
    User.countDocuments({ role: 'tenant' }),
    User.countDocuments({ role: 'owner' }),
    Lead.countDocuments(),
    VisitRequest.countDocuments(),
  ]);

  // City-wise distribution
  const cityStats = await PG.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: '$city', count: { $sum: 1 } } },
  ]);

  successResponse(res, 'Analytics retrieved', {
    pgs: { total: totalPGs, approved: approvedPGs, pending: pendingPGs, rejected: rejectedPGs, verified: verifiedPGs },
    users: { total: totalUsers, tenants: totalTenants, owners: totalOwners },
    activity: { leads: totalLeads, visits: totalVisits },
    cityStats,
  });
});

module.exports = { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics };

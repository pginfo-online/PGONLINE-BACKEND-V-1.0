const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/apiResponse');
const PG = require('../models/PG.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const VisitRequest = require('../models/VisitRequest.model');
const notificationTrigger = require('../services/notification/notification.trigger');

// /**
//  * @route GET /api/v1/admin/pgs
//  */
// const getAllPGs = asyncHandler(async (req, res) => {
//   const { status, page = 1, limit = 20 } = req.query;
//   const query = status ? { status } : {};
//   const skip = (page - 1) * limit;

//   const [pgs, total] = await Promise.all([
//     PG.find(query)
//       .populate('owner', 'name email phone')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(Number(limit))
//       .lean(),
//     PG.countDocuments(query),
//   ]);

//   successResponse(res, 'All PG listings', { pgs, total, page: Number(page), totalPages: Math.ceil(total / limit) });
// });


/**
 * @route GET /api/v1/admin/pgs
 * @desc  Get all PG listings with high-signal search, status filter, and pagination
 */
const getAllPGs = asyncHandler(async (req, res) => {
  const cleanStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const cleanSearch = typeof req.query.search === 'string' ? req.query.search.trim().replace(/\s+/g, ' ') : '';

  const page = Number.isFinite(Number(req.query.page)) && Number(req.query.page) > 0 ? Number(req.query.page) : 1;
  const limit = Number.isFinite(Number(req.query.limit)) && Number(req.query.limit) > 0
    ? Math.min(Number(req.query.limit), 50)
    : 20;

  const query = {};

  if (cleanStatus && cleanStatus !== 'all') {
    query.status = cleanStatus;
  }

  // Filter params
  const { city, area, gender, propertyType, isVerified } = req.query;

  if (city && typeof city === 'string' && city.trim()) {
    query.city = new RegExp(city.trim(), 'i');
  }

  if (area && typeof area === 'string' && area.trim()) {
    query.area = new RegExp(area.trim(), 'i');
  }

  if (gender && gender !== 'all') {
    query.gender = gender;
  }

  if (propertyType && propertyType !== 'all') {
    query.propertyType = propertyType;
  }

  if (isVerified !== undefined && isVerified !== '' && isVerified !== 'all') {
    query.isVerified = isVerified === 'true' || isVerified === true;
  }

  if (cleanSearch) {
    const searchTerms = cleanSearch.split(' ').filter(Boolean);
    const escapedTerms = searchTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Find matching owner IDs to allow searching by owner name / email / phone
    const User = require('../models/User.model');
    const matchingOwners = await User.find({
      $or: escapedTerms.flatMap((term) => [
        { name: new RegExp(term, 'i') },
        { email: new RegExp(term, 'i') },
        { phone: new RegExp(term, 'i') }
      ])
    }).select('_id').lean();

    const ownerIds = matchingOwners.map(o => o._id);

    query.$or = [
      ...escapedTerms.flatMap((term) => [
        { name: new RegExp(term, 'i') },
        { area: new RegExp(term, 'i') },
        { city: new RegExp(term, 'i') },
        { address: new RegExp(term, 'i') },
        { description: new RegExp(term, 'i') },
        { contactPhone: new RegExp(term, 'i') },
      ]),
      ...(ownerIds.length > 0 ? [{ owner: { $in: ownerIds } }] : [])
    ];
  }

  const skip = (page - 1) * limit;

  const [pgs, total] = await Promise.all([
    PG.find(query)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PG.countDocuments(query),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  paginatedResponse(res, 'All PG listings', pgs, {
    total,
    page,
    limit,
    totalPages,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  });
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
  notificationTrigger.onPGApproved(pg).catch(() => { });
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
  notificationTrigger.onPGRejected(pg, reason).catch(() => { });
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

/**
 * @route POST /api/v1/admin/users
 */
const createOwner = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  const emailLower = email.toLowerCase().trim();

  const existingUser = await User.findOne({ email: emailLower });
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'User with this email already exists' });
  }

  const user = await User.create({
    name,
    email: emailLower,
    phone: phone || undefined,
    password,
    role: 'owner',
  });

  successResponse(res, 'Owner created successfully', { user: user.toSafeObject() }, 201);
});

/**
 * @route PUT /api/v1/admin/users/:id
 */
const updateUser = asyncHandler(async (req, res) => {
  const { name, phone, role, roles } = req.body;
  const User = require('../models/User.model');

  const VALID_ROLES = [
    'admin', 'owner', 'tenant', 'staff', 'property_manager',
    'hotel_owner', 'pg_owner', 'meetup_organizer', 'hot_deals_partner',
  ];

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (name !== undefined) user.name = name;
  if (phone !== undefined) {
    if (phone) {
      const existing = await User.findOne({ phone, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(409).json({ success: false, message: 'A user with this phone number already exists' });
      }
    }
    user.phone = phone || undefined;
  }

  // Support setting a full roles array
  if (roles !== undefined) {
    if (!Array.isArray(roles)) {
      return res.status(400).json({ success: false, message: 'roles must be an array' });
    }
    const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
    if (invalidRoles.length > 0) {
      return res.status(400).json({ success: false, message: `Invalid role(s): ${invalidRoles.join(', ')}` });
    }
    user.roles = roles.length > 0 ? roles : ['tenant'];
  } else if (role !== undefined) {
    // Legacy: single role update
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    // Add to roles if not already present
    if (!user.roles) user.roles = [user.role || 'tenant'];
    if (!user.roles.includes(role)) user.roles.push(role);
    user.role = role;
  }

  await user.save();
  successResponse(res, 'User updated successfully', { user: user.toSafeObject() });
});

/**
 * @route POST /api/v1/admin/users/:id/roles/:role
 * @desc  Add a specific role to a user
 */
const addUserRole = asyncHandler(async (req, res) => {
  const VALID_ROLES = [
    'admin', 'owner', 'tenant', 'staff', 'property_manager',
    'hotel_owner', 'pg_owner', 'meetup_organizer', 'hot_deals_partner',
  ];
  const { role } = req.params;

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.roles && user.roles[0] === 'admin' && role !== 'admin') {
    // Admin users keep admin as primary but can have other roles
  }

  if (!user.roles) user.roles = [user.role || 'tenant'];
  if (!user.roles.includes(role)) {
    user.roles.push(role);
  }

  await user.save();
  successResponse(res, `Role '${role}' added successfully`, { user: user.toSafeObject() });
});

/**
 * @route DELETE /api/v1/admin/users/:id/roles/:role
 * @desc  Remove a specific role from a user
 */
const removeUserRole = asyncHandler(async (req, res) => {
  const { role } = req.params;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  if (role === 'admin' && user.role === 'admin') {
    return res.status(403).json({ success: false, message: 'Cannot remove admin role from admin user' });
  }

  if (!user.roles) user.roles = [user.role || 'tenant'];
  user.roles = user.roles.filter((r) => r !== role);
  if (user.roles.length === 0) user.roles = ['tenant'];

  await user.save();
  successResponse(res, `Role '${role}' removed successfully`, { user: user.toSafeObject() });
});

/**
 * @route PUT /api/v1/admin/users/:id/roles
 * @desc  Set the complete roles array for a user
 */
const setUserRoles = asyncHandler(async (req, res) => {
  const VALID_ROLES = [
    'admin', 'owner', 'tenant', 'staff', 'property_manager',
    'hotel_owner', 'pg_owner', 'meetup_organizer', 'hot_deals_partner',
  ];

  const { roles } = req.body;
  if (!Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ success: false, message: 'roles must be a non-empty array' });
  }

  const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
  if (invalidRoles.length > 0) {
    return res.status(400).json({ success: false, message: `Invalid role(s): ${invalidRoles.join(', ')}` });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin' && !roles.includes('admin')) {
    return res.status(403).json({ success: false, message: 'Cannot remove admin role from admin user via this endpoint' });
  }

  user.roles = roles;
  await user.save();
  successResponse(res, 'User roles updated successfully', { user: user.toSafeObject() });
});

/**
 * @route PUT /api/v1/admin/users/:id/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  const User = require('../models/User.model');
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  user.password = password;
  await user.save();

  successResponse(res, 'Password reset successfully', { user: user.toSafeObject() });
});

/**
 * @route PUT /api/v1/admin/pgs/:id
 * @desc  Admin direct edit for any PG listing
 */
const updatePGByAdmin = asyncHandler(async (req, res) => {
  const PG = require('../models/PG.model');
  const pg = await PG.findById(req.params.id);

  if (!pg) {
    return res.status(404).json({ success: false, message: 'PG listing not found' });
  }

  const updateData = { ...req.body };
  if (updateData.address || updateData.area || updateData.city) {
    try {
      const { geocodeAddress } = require('../utils/geocoder');
      const fullAddress = `${updateData.address || pg.address}, ${updateData.area || pg.area}, ${updateData.city || pg.city}`;
      const coords = await geocodeAddress(fullAddress);
      if (coords) {
        updateData.latitude = coords.latitude;
        updateData.longitude = coords.longitude;
        updateData.location = {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        };
        if (coords.fullAddress) updateData.fullAddress = coords.fullAddress;
        if (coords.postalCode) updateData.postalCode = coords.postalCode;
        if (coords.country) updateData.country = coords.country;
        if (coords.state) updateData.state = coords.state;
        if (coords.district) updateData.district = coords.district;
        if (coords.placeId) updateData.googlePlaceId = coords.placeId;
      }
    } catch (err) {
      console.error('Geocoding error in admin updatePG:', err);
    }
  }

  const updatedPG = await PG.findByIdAndUpdate(
    req.params.id,
    { $set: updateData },
    { new: true, runValidators: true }
  ).populate('owner', 'name email phone');

  successResponse(res, 'PG listing updated successfully by Admin', { pg: updatedPG });
});

module.exports = { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics, createOwner, updateUser, resetPassword, updatePGByAdmin, addUserRole, removeUserRole, setUserRoles };

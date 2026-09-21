const Property = require('../models/Property.model');
const notificationTrigger = require('../services/notification/notification.trigger');

/**
 * Get all properties for Admin with filtering, search, and pagination
 */
const getAllPropertiesForAdmin = async (params = {}) => {
  const cleanStatus = typeof params.status === 'string' ? params.status.trim() : '';
  const cleanSearch = typeof params.search === 'string' ? params.search.trim().replace(/\s+/g, ' ') : '';
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const query = {};

  if (cleanStatus && cleanStatus !== 'all') {
    if (cleanStatus === 'pending') {
      query.status = { $in: ['pending', 'submitted', 'pending_review'] };
    } else {
      query.status = cleanStatus;
    }
  }

  if (params.category && params.category !== 'all') {
    query.category = params.category;
  }

  if (params.purpose && params.purpose !== 'all') {
    query.purpose = params.purpose;
  }

  if (params.city && params.city.trim()) {
    query.city = new RegExp(params.city.trim(), 'i');
  }

  if (params.area && params.area.trim()) {
    query.area = new RegExp(params.area.trim(), 'i');
  }

  if (params.isVerified !== undefined && params.isVerified !== '' && params.isVerified !== 'all') {
    query.isVerified = params.isVerified === 'true' || params.isVerified === true;
  }

  if (params.quality && params.quality !== 'all') {
    if (params.quality === 'low') query.dataQualityScore = { $lte: 2 };
    else if (params.quality === 'good') query.dataQualityScore = 3;
    else if (params.quality === 'high') query.dataQualityScore = { $gte: 4 };
    else if (!isNaN(Number(params.quality))) query.dataQualityScore = Number(params.quality);
  }

  if (cleanSearch) {
    const terms = cleanSearch.split(' ').filter(Boolean);
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Allow searching by owner info
    const User = require('../models/User.model');
    const matchingOwners = await User.find({
      $or: escaped.flatMap((t) => [
        { name: new RegExp(t, 'i') },
        { email: new RegExp(t, 'i') },
        { phone: new RegExp(t, 'i') },
      ]),
    }).select('_id').lean();

    const ownerIds = matchingOwners.map((o) => o._id);

    query.$or = [
      ...escaped.flatMap((t) => [
        { title: new RegExp(t, 'i') },
        { area: new RegExp(t, 'i') },
        { city: new RegExp(t, 'i') },
        { address: new RegExp(t, 'i') },
        { contactPhone: new RegExp(t, 'i') },
      ]),
      ...(ownerIds.length > 0 ? [{ owner: { $in: ownerIds } }] : []),
    ];
  }

  const [properties, total] = await Promise.all([
    Property.find(query)
      .populate('owner', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Property.countDocuments(query),
  ]);

  return {
    properties,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Approve a property listing
 */
const approveProperty = async (propertyId, adminId) => {
  const property = await Property.findByIdAndUpdate(
    propertyId,
    {
      status: 'approved',
      rejectionReason: null,
      correctionComments: null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    { new: true }
  ).populate('owner', 'name email phone');

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  if (property.category === 'pg') {
    try {
      await PG.findByIdAndUpdate(propertyId, {
        $set: {
          status: 'approved',
          rejectionReason: null,
          isVerified: property.isVerified,
        },
      });
    } catch (e) {}
  }

  // Trigger notification
  if (notificationTrigger && notificationTrigger.onPGApproved) {
    notificationTrigger.onPGApproved(property).catch(() => {});
  }

  return property;
};

/**
 * Reject a property listing
 */
const rejectProperty = async (propertyId, adminId, reason) => {
  const property = await Property.findByIdAndUpdate(
    propertyId,
    {
      status: 'rejected',
      rejectionReason: reason || 'Listing does not meet quality guidelines or verification standards',
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    { new: true }
  ).populate('owner', 'name email phone');

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  if (property.category === 'pg') {
    try {
      await PG.findByIdAndUpdate(propertyId, {
        $set: {
          status: 'rejected',
          rejectionReason: reason || 'Listing does not meet quality guidelines',
        },
      });
    } catch (e) {}
  }

  if (notificationTrigger && notificationTrigger.onPGRejected) {
    notificationTrigger.onPGRejected(property, reason).catch(() => {});
  }

  return property;
};

/**
 * Request correction from owner
 */
const requestCorrection = async (propertyId, adminId, comments) => {
  const property = await Property.findByIdAndUpdate(
    propertyId,
    {
      status: 'correction_required',
      correctionComments: comments || 'Please review and update property details according to guidelines',
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    { new: true }
  ).populate('owner', 'name email phone');

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  if (property.category === 'pg') {
    try {
      await PG.findByIdAndUpdate(propertyId, {
        $set: {
          status: 'pending',
        },
      });
    } catch (e) {}
  }

  return property;
};

/**
 * Suspend a property
 */
const suspendProperty = async (propertyId, adminId, notes) => {
  const property = await Property.findByIdAndUpdate(
    propertyId,
    {
      status: 'suspended',
      moderationNotes: notes || 'Suspended by admin',
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    { new: true }
  );

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  if (property.category === 'pg') {
    try {
      await PG.findByIdAndUpdate(propertyId, {
        $set: {
          status: 'rejected',
        },
      });
    } catch (e) {}
  }

  return property;
};

/**
 * Toggle verification badge
 */
const toggleVerify = async (propertyId) => {
  const property = await Property.findById(propertyId);
  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  property.isVerified = !property.isVerified;
  property.verifiedAt = property.isVerified ? new Date() : null;
  await property.save();

  if (property.category === 'pg') {
    try {
      await PG.findByIdAndUpdate(propertyId, {
        $set: { isVerified: property.isVerified },
      });
    } catch (e) {}
  }

  return property;
};

/**
 * Get analytics counts for properties moderation
 */
const getPropertyAdminAnalytics = async () => {
  const [
    total, pending, approved, rejected, correction_required,
    pgCount, residentialCount, commercialCount, verifiedCount
  ] = await Promise.all([
    Property.countDocuments(),
    Property.countDocuments({ status: { $in: ['pending', 'submitted', 'pending_review'] } }),
    Property.countDocuments({ status: 'approved' }),
    Property.countDocuments({ status: 'rejected' }),
    Property.countDocuments({ status: 'correction_required' }),
    Property.countDocuments({ category: 'pg' }),
    Property.countDocuments({ category: 'residential_rental' }),
    Property.countDocuments({ category: 'commercial' }),
    Property.countDocuments({ isVerified: true }),
  ]);

  return {
    total,
    pending,
    approved,
    rejected,
    correction_required,
    verified: verifiedCount,
    byCategory: {
      pg: pgCount,
      residential_rental: residentialCount,
      commercial: commercialCount,
    },
  };
};

module.exports = {
  getAllPropertiesForAdmin,
  getPropertyAdminAnalytics,
  approveProperty,
  rejectProperty,
  requestCorrection,
  suspendProperty,
  toggleVerify,
};


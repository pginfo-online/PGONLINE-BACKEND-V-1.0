const PropertyUpdateRequest = require('../models/PropertyUpdateRequest.model');
const Property = require('../models/Property.model');

/**
 * Get all property update requests for admin
 */
const getAllUpdateRequests = async (params = {}) => {
  const status = typeof params.status === 'string' ? params.status.trim() : '';
  const search = typeof params.search === 'string' ? params.search.trim().replace(/\s+/g, ' ') : '';
  const category = typeof params.category === 'string' ? params.category.trim() : '';
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  if (category && category !== 'all') {
    query.category = category;
  }

  if (search) {
    const terms = search.split(' ').filter(Boolean);
    const orClauses = terms.flatMap((term) => {
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safe, 'i');
      return [
        { adminComment: regex },
        { 'proposedChanges.title': regex },
        { 'proposedChanges.name': regex },
        { 'proposedChanges.city': regex },
        { 'proposedChanges.area': regex },
        { 'originalSnapshot.title': regex },
        { 'originalSnapshot.name': regex },
      ];
    });
    query.$or = orClauses;
  }

  const [requests, total] = await Promise.all([
    PropertyUpdateRequest.find(query)
      .populate('property', 'title category purpose city area photos')
      .populate('owner', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PropertyUpdateRequest.countDocuments(query),
  ]);

  return {
    requests,
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
 * Get single request by ID
 */
const getUpdateRequestById = async (id) => {
  const request = await PropertyUpdateRequest.findById(id)
    .populate('property')
    .populate('owner', 'name email phone')
    .populate('reviewedBy', 'name email');

  if (!request) {
    const err = new Error('Property update request not found');
    err.statusCode = 404;
    throw err;
  }

  return request;
};

/**
 * Approve property update request: atomically applies proposed changes to the live Property
 */
const approveUpdateRequest = async (requestId, adminId) => {
  const request = await PropertyUpdateRequest.findById(requestId);
  if (!request) {
    const err = new Error('Update request not found');
    err.statusCode = 404;
    throw err;
  }

  if (request.status !== 'pending' && request.status !== 'correction_required') {
    const err = new Error(`Request is already in status: ${request.status}`);
    err.statusCode = 400;
    throw err;
  }

  const propertyExists = await Property.exists({ _id: request.property });
  if (!propertyExists) {
    const err = new Error('Associated property not found');
    err.statusCode = 404;
    throw err;
  }

  // Strip immutable / read-only fields
  const IMMUTABLE_FIELDS = ['_id', 'id', 'owner', 'createdAt', 'updatedAt', '__v'];
  const changes = { ...request.proposedChanges };
  IMMUTABLE_FIELDS.forEach((f) => delete changes[f]);

  // Apply changes via $set
  const updatedProperty = await Property.findByIdAndUpdate(
    request.property,
    { $set: changes },
    { new: true, runValidators: true }
  );

  if (!updatedProperty) {
    const err = new Error('Failed to apply changes to property');
    err.statusCode = 500;
    throw err;
  }

  // Mark request approved
  request.status = 'approved';
  request.reviewedAt = new Date();
  request.reviewedBy = adminId;
  request.auditLog.push({
    action: 'approved',
    by: adminId,
    at: new Date(),
    comment: 'Approved by admin and applied to live listing',
  });

  await request.save();
  return { request, property: updatedProperty };
};

/**
 * Reject property update request
 */
const rejectUpdateRequest = async (requestId, adminId, comment) => {
  const request = await PropertyUpdateRequest.findById(requestId);
  if (!request) {
    const err = new Error('Update request not found');
    err.statusCode = 404;
    throw err;
  }

  if (request.status !== 'pending' && request.status !== 'correction_required') {
    const err = new Error(`Request is already in status: ${request.status}`);
    err.statusCode = 400;
    throw err;
  }

  request.status = 'rejected';
  request.adminComment = comment || 'Changes rejected by admin';
  request.reviewedAt = new Date();
  request.reviewedBy = adminId;
  request.auditLog.push({
    action: 'rejected',
    by: adminId,
    at: new Date(),
    comment: request.adminComment,
  });

  await request.save();
  return request;
};

/**
 * Cancel update request by owner
 */
const cancelUpdateRequest = async (requestId, ownerId) => {
  const request = await PropertyUpdateRequest.findOne({ _id: requestId, owner: ownerId });
  if (!request) {
    const err = new Error('Update request not found or unauthorized');
    err.statusCode = 404;
    throw err;
  }

  if (request.status !== 'pending' && request.status !== 'correction_required') {
    const err = new Error(`Cannot cancel request in status: ${request.status}`);
    err.statusCode = 400;
    throw err;
  }

  request.status = 'cancelled';
  request.auditLog.push({
    action: 'cancelled',
    by: ownerId,
    at: new Date(),
    comment: 'Cancelled by owner',
  });

  await request.save();
  return request;
};

module.exports = {
  getAllUpdateRequests,
  getUpdateRequestById,
  approveUpdateRequest,
  rejectUpdateRequest,
  cancelUpdateRequest,
};

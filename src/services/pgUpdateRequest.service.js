const PGUpdateRequest = require('../models/PGUpdateRequest.model');
const PG = require('../models/PG.model');

/**
 * Get all update requests for admin
 */
const getAllUpdateRequests = async (params = {}) => {
  const { status, page = 1, limit = 10 } = params;
  const query = {};

  if (status) {
    query.status = status;
  }

  const parsedPage = parseInt(page, 10) || 1;
  const parsedLimit = parseInt(limit, 10) || 10;
  const skip = (parsedPage - 1) * parsedLimit;

  const [requests, total] = await Promise.all([
    PGUpdateRequest.find(query)
      .populate('pg', 'name city area photos')
      .populate('owner', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    PGUpdateRequest.countDocuments(query),
  ]);

  return {
    requests,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit),
    },
  };
};

/**
 * Get a request by ID
 */
const getUpdateRequestById = async (id) => {
  const request = await PGUpdateRequest.findById(id)
    .populate('pg')
    .populate('owner', 'name email phone')
    .populate('reviewedBy', 'name email');

  if (!request) {
    const err = new Error('Update request not found');
    err.statusCode = 404;
    throw err;
  }

  return request;
};

/**
 * Approve PG update request: applies proposed changes to the live PG
 */
const approveUpdateRequest = async (requestId, adminId) => {
  const request = await PGUpdateRequest.findById(requestId);
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

  const livePG = await PG.findById(request.pg);
  if (!livePG) {
    const err = new Error('Associated PG not found');
    err.statusCode = 404;
    throw err;
  }

  // Apply proposed changes to the live PG document
  const changes = request.proposedChanges;
  Object.keys(changes).forEach((key) => {
    // Avoid overriding internal or immutable fields if they snuck in
    if (['_id', 'id', 'owner', 'createdAt', 'updatedAt', '__v'].includes(key)) return;

    if (key === 'rent' && changes.rent) {
      // Merge rent objects
      livePG.rent = {
        ...livePG.rent,
        ...changes.rent,
      };
    } else {
      livePG[key] = changes[key];
    }
  });

  // Save the updated live PG listing
  await livePG.save();

  // Update the request status
  request.status = 'approved';
  request.reviewedAt = new Date();
  request.reviewedBy = adminId;
  request.auditLog.push({
    action: 'approved',
    by: adminId,
    at: new Date(),
    comment: 'Approved by admin',
  });

  await request.save();

  return request;
};

/**
 * Reject PG update request
 */
const rejectUpdateRequest = async (requestId, adminId, comment) => {
  const request = await PGUpdateRequest.findById(requestId);
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
  request.adminComment = comment || 'Rejected by admin';
  request.reviewedAt = new Date();
  request.reviewedBy = adminId;
  request.auditLog.push({
    action: 'rejected',
    by: adminId,
    at: new Date(),
    comment: comment || 'Rejected by admin',
  });

  await request.save();
  return request;
};

/**
 * Request correction on PG update request
 */
const requestCorrection = async (requestId, adminId, comment) => {
  if (!comment) {
    const err = new Error('Correction comment is required');
    err.statusCode = 400;
    throw err;
  }

  const request = await PGUpdateRequest.findById(requestId);
  if (!request) {
    const err = new Error('Update request not found');
    err.statusCode = 404;
    throw err;
  }

  if (request.status !== 'pending') {
    const err = new Error(`Request is already in status: ${request.status}`);
    err.statusCode = 400;
    throw err;
  }

  request.status = 'correction_required';
  request.adminComment = comment;
  request.auditLog.push({
    action: 'correction_required',
    by: adminId,
    at: new Date(),
    comment,
  });

  await request.save();
  return request;
};

/**
 * Get owner's own requests
 */
const getMyUpdateRequests = async (ownerId) => {
  return PGUpdateRequest.find({ owner: ownerId })
    .populate('pg', 'name city area photos')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Cancel a pending request by the owner
 */
const cancelUpdateRequest = async (requestId, ownerId) => {
  const request = await PGUpdateRequest.findById(requestId);
  if (!request) {
    const err = new Error('Update request not found');
    err.statusCode = 404;
    throw err;
  }

  if (request.owner.toString() !== ownerId.toString()) {
    const err = new Error('Unauthorized to cancel this request');
    err.statusCode = 403;
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
  requestCorrection,
  getMyUpdateRequests,
  cancelUpdateRequest,
};

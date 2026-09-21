const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/apiResponse');
const propertyUpdateRequestService = require('../services/propertyUpdateRequest.service');

/**
 * @route GET /api/v1/admin/property-updates
 */
const getAllUpdateRequests = asyncHandler(async (req, res) => {
  const { requests, pagination } = await propertyUpdateRequestService.getAllUpdateRequests(req.query);
  paginatedResponse(res, 'Property update requests retrieved', requests, pagination);
});

/**
 * @route GET /api/v1/admin/property-updates/:id
 */
const getUpdateRequestById = asyncHandler(async (req, res) => {
  const request = await propertyUpdateRequestService.getUpdateRequestById(req.params.id);
  successResponse(res, 'Update request details retrieved', { request });
});

/**
 * @route PUT /api/v1/admin/property-updates/:id/approve
 */
const approveUpdateRequest = asyncHandler(async (req, res) => {
  const result = await propertyUpdateRequestService.approveUpdateRequest(req.params.id, req.user._id);
  successResponse(res, 'Update request approved and merged to live listing', result);
});

/**
 * @route PUT /api/v1/admin/property-updates/:id/reject
 */
const rejectUpdateRequest = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const request = await propertyUpdateRequestService.rejectUpdateRequest(req.params.id, req.user._id, reason);
  successResponse(res, 'Update request rejected', { request });
});

/**
 * @route PUT /api/v1/admin/property-updates/:id/correction
 */
const requestCorrection = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  const request = await propertyUpdateRequestService.requestCorrection(req.params.id, req.user._id, comment);
  successResponse(res, 'Correction requested on property update', { request });
});

/**
 * @route DELETE /api/v1/property-updates/:id/cancel
 */
const cancelUpdateRequest = asyncHandler(async (req, res) => {
  const request = await propertyUpdateRequestService.cancelUpdateRequest(req.params.id, req.user._id);
  successResponse(res, 'Update request cancelled', { request });
});

module.exports = {
  getAllUpdateRequests,
  getUpdateRequestById,
  approveUpdateRequest,
  rejectUpdateRequest,
  requestCorrection,
  cancelUpdateRequest,
};

const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/apiResponse');
const pgUpdateRequestService = require('../services/pgUpdateRequest.service');

/**
 * @route GET /api/v1/admin/pg-updates
 */
const getAllUpdateRequests = asyncHandler(async (req, res) => {
  const { requests, pagination } = await pgUpdateRequestService.getAllUpdateRequests(req.query);
  paginatedResponse(res, 'PG update requests retrieved', requests, pagination);
});

/**
 * @route GET /api/v1/admin/pg-updates/:id
 */
const getUpdateRequestById = asyncHandler(async (req, res) => {
  const request = await pgUpdateRequestService.getUpdateRequestById(req.params.id);
  successResponse(res, 'PG update request details retrieved', { request });
});

/**
 * @route PUT /api/v1/admin/pg-updates/:id/approve
 */
const approveUpdateRequest = asyncHandler(async (req, res) => {
  const request = await pgUpdateRequestService.approveUpdateRequest(req.params.id, req.user._id);
  successResponse(res, 'PG update request approved and changes applied', { request });
});

/**
 * @route PUT /api/v1/admin/pg-updates/:id/reject
 */
const rejectUpdateRequest = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  const request = await pgUpdateRequestService.rejectUpdateRequest(req.params.id, req.user._id, comment);
  successResponse(res, 'PG update request rejected', { request });
});

/**
 * @route PUT /api/v1/admin/pg-updates/:id/correction
 */
const requestCorrection = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  const request = await pgUpdateRequestService.requestCorrection(req.params.id, req.user._id, comment);
  successResponse(res, 'Correction requested on PG update', { request });
});

/**
 * @route GET /api/v1/pg/my/update-requests
 */
const getMyUpdateRequests = asyncHandler(async (req, res) => {
  const requests = await pgUpdateRequestService.getMyUpdateRequests(req.user._id);
  successResponse(res, 'Your PG update requests retrieved', { requests });
});

/**
 * @route DELETE /api/v1/pg/my/update-requests/:id
 */
const cancelUpdateRequest = asyncHandler(async (req, res) => {
  const request = await pgUpdateRequestService.cancelUpdateRequest(req.params.id, req.user._id);
  successResponse(res, 'PG update request cancelled successfully', { request });
});

module.exports = {
  getAllUpdateRequests,
  getUpdateRequestById,
  approveUpdateRequest,
  rejectUpdateRequest,
  requestCorrection,
  getMyUpdateRequests,
  cancelUpdateRequest,
};

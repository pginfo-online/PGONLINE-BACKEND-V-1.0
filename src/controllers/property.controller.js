const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse, errorResponse } = require('../utils/apiResponse');
const propertyService = require('../services/property.service');
const propertySearchService = require('../services/propertySearch.service');
const propertyApprovalService = require('../services/propertyApproval.service');

/**
 * @route GET /api/v1/properties
 * Unified property discovery & search
 */
const getProperties = asyncHandler(async (req, res) => {
  const { properties, pagination } = await propertySearchService.searchProperties(req.query);
  paginatedResponse(res, 'Properties retrieved successfully', properties, pagination);
});

/**
 * @route GET /api/v1/properties/suggestions
 * Search autocomplete suggestions
 */
const getPropertySuggestions = asyncHandler(async (req, res) => {
  const { q, sessiontoken } = req.query;
  const suggestions = await propertySearchService.getPropertySuggestions(q, sessiontoken);
  successResponse(res, 'Suggestions retrieved', { suggestions });
});

/**
 * @route GET /api/v1/properties/:id
 * Single property detail
 */
const getPropertyById = asyncHandler(async (req, res) => {
  const property = await propertyService.getPropertyById(req.params.id, req.user);
  successResponse(res, 'Property details retrieved', { property });
});

/**
 * @route POST /api/v1/properties
 * Create a property listing (PG, Residential Rental, Commercial)
 */
const createProperty = asyncHandler(async (req, res) => {
  const property = await propertyService.createProperty(req.user._id, req.body);
  successResponse(res, 'Property listing created and submitted for review', { property }, 201);
});

/**
 * @route PUT /api/v1/properties/:id
 * Update a property listing (Direct for admin/draft; staging update request for approved listings)
 */
const updateProperty = asyncHandler(async (req, res) => {
  const result = await propertyService.updateProperty(
    req.params.id,
    req.user._id,
    req.body,
    req.user.role
  );

  if (result.requestCreated) {
    successResponse(
      res,
      'Changes submitted for admin approval. Your listing will update once reviewed.',
      result
    );
  } else {
    successResponse(res, 'Property updated successfully', result);
  }
});

/**
 * @route DELETE /api/v1/properties/:id
 * Delete a property listing
 */
const deleteProperty = asyncHandler(async (req, res) => {
  await propertyService.deleteProperty(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'Property listing deleted successfully');
});

/**
 * @route GET /api/v1/properties/my
 * Owner's properties (paginated)
 */
const getMyProperties = asyncHandler(async (req, res) => {
  const { properties, pagination } = await propertyService.getMyPropertiesPaginated(
    req.user._id,
    req.query
  );
  paginatedResponse(res, 'Your listings retrieved', properties, pagination);
});

// ─── Admin Moderation Handlers ───────────────────────────────────────────────

/**
 * @route GET /api/v1/properties/admin/analytics
 */
const getAdminAnalytics = asyncHandler(async (req, res) => {
  const stats = await propertyApprovalService.getPropertyAdminAnalytics();
  successResponse(res, 'Admin property analytics retrieved', stats);
});

/**
 * @route GET /api/v1/properties/admin/all
 * Admin queue across all categories
 */
const getAdminProperties = asyncHandler(async (req, res) => {
  const { properties, pagination } = await propertyApprovalService.getAllPropertiesForAdmin(req.query);
  paginatedResponse(res, 'Admin property queue retrieved', properties, pagination);
});

/**
 * @route PUT /api/v1/properties/admin/:id/approve
 */
const approveProperty = asyncHandler(async (req, res) => {
  const property = await propertyApprovalService.approveProperty(req.params.id, req.user._id);
  successResponse(res, 'Property approved successfully', { property });
});

/**
 * @route PUT /api/v1/admin/properties/:id/reject
 */
const rejectProperty = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const property = await propertyApprovalService.rejectProperty(req.params.id, req.user._id, reason);
  successResponse(res, 'Property rejected', { property });
});

/**
 * @route PUT /api/v1/admin/properties/:id/request-correction
 */
const requestCorrection = asyncHandler(async (req, res) => {
  const { comments } = req.body;
  const property = await propertyApprovalService.requestCorrection(req.params.id, req.user._id, comments);
  successResponse(res, 'Correction requested from owner', { property });
});

/**
 * @route PUT /api/v1/admin/properties/:id/verify
 */
const toggleVerify = asyncHandler(async (req, res) => {
  const property = await propertyApprovalService.toggleVerify(req.params.id);
  successResponse(res, `Property ${property.isVerified ? 'verified' : 'unverified'}`, { property });
});

/**
 * @route PUT /api/v1/admin/properties/:id/suspend
 */
const suspendProperty = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const property = await propertyApprovalService.suspendProperty(req.params.id, req.user._id, notes);
  successResponse(res, 'Property suspended', { property });
});

module.exports = {
  getProperties,
  getPropertySuggestions,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  getMyProperties,
  getAdminAnalytics,
  getAdminProperties,
  approveProperty,
  rejectProperty,
  requestCorrection,
  toggleVerify,
  suspendProperty,
};

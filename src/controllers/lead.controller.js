const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const leadService = require('../services/lead.service');

/**
 * @route POST /api/v1/lead
 */
const addLead = asyncHandler(async (req, res) => {
  const { pgId, type = 'inquiry', message } = req.body;
  const result = await leadService.addLead(pgId, req.user._id, type, message);

  const msg = result.action === 'removed'
    ? 'Removed from wishlist'
    : result.action === 'exists'
    ? 'Already exists'
    : type === 'wishlist' ? 'Added to wishlist' : 'Inquiry sent successfully';

  successResponse(res, msg, result.lead ? { lead: result.lead } : null,
    result.action === 'created' ? 201 : 200);
});

/**
 * @route GET /api/v1/lead/my
 */
const getMyLeads = asyncHandler(async (req, res) => {
  const { type } = req.query;
  const leads = await leadService.getTenantLeads(req.user._id, type);
  successResponse(res, 'Leads retrieved', { leads });
});

/**
 * @route GET /api/v1/lead/pg/:pgId
 */
const getPGLeads = asyncHandler(async (req, res) => {
  const leads = await leadService.getPGLeads(req.params.pgId, req.user._id);
  successResponse(res, 'PG leads retrieved', { leads });
});

module.exports = { addLead, getMyLeads, getPGLeads };

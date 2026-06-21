const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const VisitRequest = require('../models/VisitRequest.model');
const PG = require('../models/PG.model');

/**
 * @route POST /api/v1/visit
 */
const createVisit = asyncHandler(async (req, res) => {
  const { pgId, scheduledDate, scheduledTime, message } = req.body;

  const pg = await PG.findById(pgId).populate('owner');
  if (!pg || pg.status !== 'approved') {
    return res.status(404).json({ success: false, message: 'PG not found or not available' });
  }

  const visit = await VisitRequest.create({
    pg: pgId,
    tenant: req.user._id,
    owner: pg.owner._id,
    scheduledDate: new Date(scheduledDate),
    scheduledTime,
    message,
  });

  await visit.populate([
    { path: 'pg', select: 'name area city' },
    { path: 'tenant', select: 'name phone' },
  ]);

  successResponse(res, 'Visit request sent successfully', { visit }, 201);
});

/**
 * @route GET /api/v1/visit/my
 */
const getMyVisits = asyncHandler(async (req, res) => {
  const visits = await VisitRequest.find({ tenant: req.user._id })
    .populate('pg', 'name area city photos')
    .populate('owner', 'name phone')
    .sort({ scheduledDate: -1 })
    .lean();

  successResponse(res, 'Visit requests retrieved', { visits });
});

/**
 * @route GET /api/v1/visit/pg/:pgId
 */
const getPGVisits = asyncHandler(async (req, res) => {
  const pg = await PG.findOne({ _id: req.params.pgId, owner: req.user._id });
  if (!pg) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const visits = await VisitRequest.find({ pg: req.params.pgId })
    .populate('tenant', 'name email phone')
    .sort({ scheduledDate: 1 })
    .lean();

  successResponse(res, 'Visit requests for PG retrieved', { visits });
});

/**
 * @route PUT /api/v1/visit/:id/status
 */
const updateVisitStatus = asyncHandler(async (req, res) => {
  const { status, ownerNote } = req.body;
  const visit = await VisitRequest.findOne({ _id: req.params.id, owner: req.user._id });

  if (!visit) {
    return res.status(404).json({ success: false, message: 'Visit request not found' });
  }

  visit.status = status;
  if (ownerNote) visit.ownerNote = ownerNote;
  await visit.save();

  successResponse(res, `Visit request ${status}`, { visit });
});

module.exports = { createVisit, getMyVisits, getPGVisits, updateVisitStatus };

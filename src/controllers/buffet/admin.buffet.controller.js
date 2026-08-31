const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Buffet = require('../../models/Buffet.model');
const BuffetMenu = require('../../models/BuffetMenu.model');
const WeeklyBuffetPlan = require('../../models/WeeklyBuffetPlan.model');
const BuffetReview = require('../../models/BuffetReview.model');
const BuffetReservation = require('../../models/BuffetReservation.model');
const Hotel = require('../../models/Hotel.model');
const buffetService = require('../../services/buffet/buffet.service');

/**
 * Admin Buffet Controller — review, approve/reject buffets and weekly plans,
 * view analytics, manage reservations.
 */

// ─── All Buffets ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/buffets
 */
const getBuffets = asyncHandler(async (req, res) => {
  const { status, city, hotel, date, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = buffetService.buildAdminBuffetQuery({ status, city, hotel, date });

  const [buffets, total] = await Promise.all([
    Buffet.find(query)
      .populate('hotel', 'name city area')
      .populate('owner', 'name email')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Buffet.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Buffets retrieved', buffets, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * GET /api/v1/buffet/admin/buffets/:id
 */
const getBuffet = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id)
    .populate('hotel', 'name city area address contactPhone')
    .populate('owner', 'name email phone')
    .populate('approvedBy', 'name')
    .populate('statusHistory.changedBy', 'name')
    .lean();

  if (!buffet) return errorResponse(res, 'Buffet not found', 404);

  const [menu, reservationCount] = await Promise.all([
    BuffetMenu.findOne({ buffet: buffet._id }).lean(),
    BuffetReservation.countDocuments({ buffet: buffet._id }),
  ]);

  return successResponse(res, 'Buffet retrieved', { buffet, menu, reservationCount });
});

/**
 * PUT /api/v1/buffet/admin/buffets/:id/approve
 */
const approveBuffet = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id);
  if (!buffet) return errorResponse(res, 'Buffet not found', 404);

  const updated = await buffetService.approveBuffet(buffet, req.user._id);

  // Notify hotel owner
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerBuffetApproved(updated.owner, updated);
  } catch (err) {
    console.error('[AdminBuffetController] Approval notification error:', err.message);
  }

  return successResponse(res, `Buffet approved and set to ${updated.status}`, { buffet: updated });
});

/**
 * PUT /api/v1/buffet/admin/buffets/:id/reject
 */
const rejectBuffet = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason) return errorResponse(res, 'Rejection reason is required', 400);

  const buffet = await Buffet.findById(req.params.id);
  if (!buffet) return errorResponse(res, 'Buffet not found', 404);

  const updated = await buffetService.rejectBuffet(buffet, req.user._id, rejectionReason);

  // Notify hotel owner
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerBuffetRejected(updated.owner, updated, rejectionReason);
  } catch (err) {
    console.error('[AdminBuffetController] Rejection notification error:', err.message);
  }

  return successResponse(res, 'Buffet rejected', { buffet: updated });
});

/**
 * PUT /api/v1/buffet/admin/buffets/:id/go-live — Force a buffet to live status
 */
const forceGoLive = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id);
  if (!buffet) return errorResponse(res, 'Buffet not found', 404);
  if (!['approved', 'scheduled'].includes(buffet.status)) {
    return errorResponse(res, 'Only approved or scheduled buffets can be forced live', 400);
  }

  buffet.statusHistory.push({ status: 'live', changedBy: req.user._id, changedAt: new Date(), reason: 'forced live by admin' });
  buffet.status = 'live';
  await buffet.save();

  return successResponse(res, 'Buffet is now live', { buffet });
});

/**
 * POST /api/v1/buffet/admin/buffets — Admin directly creates a buffet
 */
const createBuffet = asyncHandler(async (req, res) => {
  const { hotelId, ...buffetData } = req.body;

  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);
  if (hotel.status !== 'approved') return errorResponse(res, 'Hotel must be approved first', 400);

  const buffet = await buffetService.createBuffet(buffetData, hotel, req.user._id);

  // Admin-created buffets go straight to approved
  buffet.status = 'approved';
  buffet.approvedBy = req.user._id;
  buffet.approvedAt = new Date();
  buffet.statusHistory.push({ status: 'approved', changedBy: req.user._id, changedAt: new Date(), reason: 'admin direct creation' });

  const now = new Date();
  const buffetDate = new Date(buffet.date);
  if (buffetDate <= now) {
    const startAt = new Date(buffetDate);
    const [h, m] = buffet.startTime.split(':').map(Number);
    startAt.setUTCHours(h, m, 0, 0);
    if (startAt <= now) {
      buffet.status = 'live';
      buffet.statusHistory.push({ status: 'live', changedBy: req.user._id, changedAt: new Date(), reason: 'admin direct creation' });
    }
  }

  await buffet.save();
  return successResponse(res, 'Buffet created successfully', { buffet }, 201);
});

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/weekly-plans
 */
const getWeeklyPlans = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (status) query.status = status;

  const [plans, total] = await Promise.all([
    WeeklyBuffetPlan.find(query)
      .populate('hotel', 'name city area')
      .populate('owner', 'name email')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    WeeklyBuffetPlan.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Weekly plans retrieved', plans, {
    total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * PUT /api/v1/buffet/admin/weekly-plans/:id/approve — Approve entire week plan
 */
const approveWeeklyPlan = asyncHandler(async (req, res) => {
  const plan = await WeeklyBuffetPlan.findById(req.params.id).populate('buffets');
  if (!plan) return errorResponse(res, 'Weekly plan not found', 404);
  if (plan.status !== 'submitted') return errorResponse(res, 'Plan must be submitted first', 400);

  const now = new Date();
  const buffetUpdates = plan.buffets.map(async (buffet) => {
    if (!['submitted', 'under_review'].includes(buffet.status)) return;
    const buffetDate = new Date(buffet.date);
    const newStatus = buffetDate <= now ? 'live' : 'scheduled';
    buffet.status = newStatus;
    buffet.approvedBy = req.user._id;
    buffet.approvedAt = now;
    buffet.statusHistory.push({ status: newStatus, changedBy: req.user._id, changedAt: now, reason: 'approved via weekly plan' });
    return buffet.save();
  });

  await Promise.all(buffetUpdates);

  plan.status = 'approved';
  plan.reviewedBy = req.user._id;
  plan.reviewedAt = now;
  await plan.save();

  return successResponse(res, 'Weekly plan approved — all buffets scheduled', { plan });
});

/**
 * PUT /api/v1/buffet/admin/weekly-plans/:id/reject
 */
const rejectWeeklyPlan = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason) return errorResponse(res, 'Rejection reason is required', 400);

  const plan = await WeeklyBuffetPlan.findById(req.params.id);
  if (!plan) return errorResponse(res, 'Weekly plan not found', 404);

  plan.status = 'rejected';
  plan.reviewedBy = req.user._id;
  plan.reviewedAt = new Date();
  plan.rejectionReason = rejectionReason;
  await plan.save();

  // Also reject all buffets in the plan
  await Buffet.updateMany(
    { weeklyPlanId: plan._id, status: { $in: ['submitted', 'under_review'] } },
    {
      $set: { status: 'rejected', rejectionReason },
      $push: { statusHistory: { status: 'rejected', changedBy: req.user._id, changedAt: new Date(), reason: rejectionReason } },
    }
  );

  return successResponse(res, 'Weekly plan rejected', { plan });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const [
    totalHotels,
    activeHotels,
    pendingRegistrations,
    totalBuffets,
    liveBuffets,
    pendingBuffets,
    totalReservations,
  ] = await Promise.all([
    Hotel.countDocuments(),
    Hotel.countDocuments({ status: 'approved', isActive: true }),
    require('../../models/HotelRegistrationRequest.model').countDocuments({ status: 'pending' }),
    Buffet.countDocuments(),
    Buffet.countDocuments({ status: 'live' }),
    Buffet.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
    BuffetReservation.countDocuments(),
  ]);

  const recentBuffets = await Buffet.find({ status: { $in: ['submitted', 'under_review'] } })
    .populate('hotel', 'name city')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return successResponse(res, 'Analytics retrieved', {
    analytics: {
      hotels: { total: totalHotels, active: activeHotels, pendingRegistrations },
      buffets: { total: totalBuffets, live: liveBuffets, pendingReview: pendingBuffets },
      reservations: { total: totalReservations },
    },
    pendingReview: recentBuffets,
  });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/reviews
 */
const getReviews = asyncHandler(async (req, res) => {
  const { isVisible, isReported, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (isVisible !== undefined) query.isVisible = isVisible === 'true';
  if (isReported !== undefined) query.isReported = isReported === 'true';

  const [reviews, total] = await Promise.all([
    BuffetReview.find(query)
      .populate('user', 'name')
      .populate('buffet', 'name')
      .populate('hotel', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    BuffetReview.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Reviews retrieved', reviews, {
    total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * PUT /api/v1/buffet/admin/reviews/:id/toggle-visibility
 */
const toggleReviewVisibility = asyncHandler(async (req, res) => {
  const review = await BuffetReview.findById(req.params.id);
  if (!review) return errorResponse(res, 'Review not found', 404);

  review.isVisible = !review.isVisible;
  if (!review.isVisible && req.body.hiddenReason) {
    review.hiddenReason = req.body.hiddenReason;
  }
  await review.save();

  return successResponse(res, `Review ${review.isVisible ? 'made visible' : 'hidden'}`, { review });
});

module.exports = {
  getBuffets,
  getBuffet,
  approveBuffet,
  rejectBuffet,
  forceGoLive,
  createBuffet,
  getWeeklyPlans,
  approveWeeklyPlan,
  rejectWeeklyPlan,
  getAnalytics,
  getReviews,
  toggleReviewVisibility,
};

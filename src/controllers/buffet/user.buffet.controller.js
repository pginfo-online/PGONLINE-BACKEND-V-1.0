const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Buffet = require('../../models/Buffet.model');
const BuffetReservation = require('../../models/BuffetReservation.model');
const BuffetReview = require('../../models/BuffetReview.model');
const Hotel = require('../../models/Hotel.model');
const buffetService = require('../../services/buffet/buffet.service');
const hotelService = require('../../services/buffet/hotel.service');

/**
 * User Buffet Controller — authenticated user actions:
 *   - Reserve / cancel reservation
 *   - Post / view reviews
 *   - View their buffet history
 */

// ─── Reservations ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/buffet/:id/reserve
 */
const reserveBuffet = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id).lean();
  if (!buffet) return errorResponse(res, 'Buffet not found', 404);
  if (buffet.status !== 'live' || !buffet.isActive) {
    return errorResponse(res, 'This buffet is not available for reservation', 400);
  }
  if (buffet.expiresAt && buffet.expiresAt < new Date()) {
    return errorResponse(res, 'This buffet has expired', 400);
  }

  const partySize = Number(req.body.partySize) || 1;

  // Check capacity
  if (!buffetService.checkCapacity(buffet, partySize)) {
    return errorResponse(res, 'Insufficient capacity. Only limited seats available.', 400);
  }

  // Check for duplicate reservation
  const existing = await BuffetReservation.findOne({
    buffet: buffet._id,
    user: req.user._id,
    status: 'reserved',
  });
  if (existing) return errorResponse(res, 'You already have an active reservation for this buffet', 409);

  // Create reservation
  const hotel = await Hotel.findById(buffet.hotel).lean();
  const reservation = await BuffetReservation.create({
    buffet: buffet._id,
    hotel: buffet.hotel,
    user: req.user._id,
    buffetDate: buffet.date,
    partySize,
    specialRequests: req.body.specialRequests,
    // Denormalized fields
    buffetName: buffet.name,
    hotelName: hotel?.name || '',
    pricePerPerson: buffet.pricePerPerson,
    city: buffet.city,
    area: buffet.area,
  });

  // Increment capacity counter
  await buffetService.incrementReservations(buffet._id, partySize);

  // Send confirmation notification
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerBuffetReservationConfirmed(req.user._id, reservation, buffet, hotel);
  } catch (err) {
    console.error('[UserBuffetController] Reservation notification error:', err.message);
  }

  return successResponse(
    res,
    'Reservation confirmed! See you at the buffet.',
    { reservation },
    201
  );
});

/**
 * GET /api/v1/buffet/my-reservations
 */
const getMyReservations = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = { user: req.user._id };
  if (status) query.status = status;

  const [reservations, total] = await Promise.all([
    BuffetReservation.find(query)
      .populate('buffet', 'name date startTime endTime type pricePerPerson images')
      .populate('hotel', 'name city area coverImage logo')
      .sort({ buffetDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    BuffetReservation.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Your reservations retrieved', reservations, {
    total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * PUT /api/v1/buffet/reservations/:id/cancel
 */
const cancelReservation = asyncHandler(async (req, res) => {
  const reservation = await BuffetReservation.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!reservation) return errorResponse(res, 'Reservation not found', 404);
  if (reservation.status !== 'reserved') {
    return errorResponse(res, 'Only active reservations can be cancelled', 400);
  }

  // Check cancellation window (must be >1h before buffet start)
  const buffet = await Buffet.findById(reservation.buffet).lean();
  if (buffet) {
    const startAt = new Date(buffet.date);
    const [h, m] = buffet.startTime.split(':').map(Number);
    startAt.setUTCHours(h, m, 0, 0);
    const oneHourBefore = new Date(startAt.getTime() - 60 * 60 * 1000);
    if (new Date() > oneHourBefore) {
      return errorResponse(res, 'Reservations cannot be cancelled within 1 hour of the buffet start', 400);
    }
  }

  reservation.status = 'cancelled';
  reservation.cancelledAt = new Date();
  reservation.cancellationReason = req.body.cancellationReason;
  reservation.cancelledBy = 'user';
  await reservation.save();

  // Release capacity
  if (buffet) {
    await buffetService.decrementReservations(reservation.buffet, reservation.partySize);
  }

  // Send cancellation notification
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerBuffetReservationCancelled(req.user._id, reservation);
  } catch (err) {
    console.error('[UserBuffetController] Cancellation notification error:', err.message);
  }

  return successResponse(res, 'Reservation cancelled', { reservation });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/:id/reviews
 */
const getBuffetReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [reviews, total, avgStats] = await Promise.all([
    BuffetReview.find({ buffet: req.params.id, isVisible: true })
      .populate('user', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    BuffetReview.countDocuments({ buffet: req.params.id, isVisible: true }),
    BuffetReview.aggregate([
      { $match: { buffet: require('mongoose').Types.ObjectId.createFromHexString(req.params.id), isVisible: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          avgFoodQuality: { $avg: '$foodQualityRating' },
          avgValue: { $avg: '$valueRating' },
          avgService: { $avg: '$serviceRating' },
          avgAmbiance: { $avg: '$ambianceRating' },
        },
      },
    ]),
  ]);

  return paginatedResponse(res, 'Reviews retrieved', reviews, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
    stats: avgStats[0] || null,
  });
});

/**
 * POST /api/v1/buffet/:id/reviews
 */
const postBuffetReview = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id).lean();
  if (!buffet) return errorResponse(res, 'Buffet not found', 404);
  if (!['live', 'completed'].includes(buffet.status)) {
    return errorResponse(res, 'Reviews can only be posted for live or completed buffets', 400);
  }

  // Check for duplicate review
  const existing = await BuffetReview.findOne({ buffet: buffet._id, user: req.user._id });
  if (existing) return errorResponse(res, 'You have already reviewed this buffet', 409);

  // Check if user has a completed reservation (for verified badge)
  const verifiedReservation = await BuffetReservation.findOne({
    buffet: buffet._id,
    user: req.user._id,
    status: { $in: ['completed', 'arrived'] },
  });

  const review = await BuffetReview.create({
    buffet: buffet._id,
    hotel: buffet.hotel,
    user: req.user._id,
    reservation: verifiedReservation?._id || null,
    isVerified: !!verifiedReservation,
    ...req.body,
  });

  // Update hotel avgRating
  await hotelService.syncHotelRating(buffet.hotel);

  return successResponse(res, 'Review posted successfully', { review }, 201);
});

module.exports = {
  reserveBuffet,
  getMyReservations,
  cancelReservation,
  getBuffetReviews,
  postBuffetReview,
};

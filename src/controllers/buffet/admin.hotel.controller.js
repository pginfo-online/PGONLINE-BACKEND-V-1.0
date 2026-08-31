const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Hotel = require('../../models/Hotel.model');
const HotelRegistrationRequest = require('../../models/HotelRegistrationRequest.model');
const User = require('../../models/User.model');
const hotelService = require('../../services/buffet/hotel.service');
const { uploadToCloudinary } = require('../../config/cloudinary');

/**
 * Admin Hotel Controller — manage hotels and registration requests.
 */

// ─── Registration Requests ────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/registrations
 */
const getRegistrations = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (status) query.status = status;

  const [registrations, total] = await Promise.all([
    HotelRegistrationRequest.find(query)
      .populate('user', 'name email phone')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    HotelRegistrationRequest.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Registrations retrieved', registrations, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * GET /api/v1/buffet/admin/registrations/:id
 */
const getRegistration = asyncHandler(async (req, res) => {
  const request = await HotelRegistrationRequest.findById(req.params.id)
    .populate('user', 'name email phone isHotelOwner')
    .populate('reviewedBy', 'name')
    .populate('createdHotel', 'name status')
    .lean();

  if (!request) return errorResponse(res, 'Registration request not found', 404);
  return successResponse(res, 'Registration retrieved', { registration: request });
});

/**
 * PUT /api/v1/buffet/admin/registrations/:id/approve
 */
const approveRegistration = asyncHandler(async (req, res) => {
  const request = await HotelRegistrationRequest.findById(req.params.id);
  if (!request) return errorResponse(res, 'Registration request not found', 404);
  if (request.status === 'approved') return errorResponse(res, 'Already approved', 400);

  const { hotel, userId } = await hotelService.approveRegistration(req.params.id, req.user._id);

  // Grant hotel_owner role via the multi-role roles array
  // This also syncs isHotelOwner via the pre-save hook
  await User.findByIdAndUpdate(
    userId,
    { $addToSet: { roles: 'hotel_owner' }, isHotelOwner: true },
    { new: true }
  );

  // Send push notification
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerHotelRegistrationApproved(userId, hotel);
  } catch (err) {
    console.error('[AdminHotelController] Notification error:', err.message);
  }

  return successResponse(res, 'Hotel registration approved. Owner has been notified.', {
    hotel: { _id: hotel._id, name: hotel.name, status: hotel.status },
  });
});

/**
 * PUT /api/v1/buffet/admin/registrations/:id/reject
 */
const rejectRegistration = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason) return errorResponse(res, 'Rejection reason is required', 400);

  const request = await hotelService.rejectRegistration(req.params.id, req.user._id, rejectionReason);

  // Send push notification
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerHotelRegistrationRejected(request.user, rejectionReason);
  } catch (err) {
    console.error('[AdminHotelController] Notification error:', err.message);
  }

  return successResponse(res, 'Registration request rejected');
});

// ─── Hotels CRUD ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/admin/hotels
 */
const getHotels = asyncHandler(async (req, res) => {
  const { status, city, isVerified, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (status) query.status = status;
  if (city) query.city = city;
  if (isVerified !== undefined) query.isVerified = isVerified === 'true';

  const [hotels, total] = await Promise.all([
    Hotel.find(query)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Hotel.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Hotels retrieved', hotels, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * GET /api/v1/buffet/admin/hotels/:id
 */
const getHotel = asyncHandler(async (req, res) => {
  const hotel = await hotelService.getHotelById(req.params.id, true);
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  // Get buffet stats
  const Buffet = require('../../models/Buffet.model');
  const stats = await Buffet.aggregate([
    { $match: { hotel: hotel._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  return successResponse(res, 'Hotel retrieved', { hotel, buffetStats: stats });
});

/**
 * POST /api/v1/buffet/admin/hotels — Admin directly creates hotel
 */
const createHotel = asyncHandler(async (req, res) => {
  const { owner: ownerId, ...hotelData } = req.body;

  // Validate owner exists
  const owner = await User.findById(ownerId);
  if (!owner) return errorResponse(res, 'Owner user not found', 404);

  const hotel = await hotelService.createHotel({ ...hotelData, owner: ownerId });

  // Grant hotel_owner role
  if (!owner.isHotelOwner) {
    await User.findByIdAndUpdate(ownerId, { isHotelOwner: true, role: 'hotel_owner' });
  }

  return successResponse(res, 'Hotel created successfully', { hotel }, 201);
});

/**
 * PUT /api/v1/buffet/admin/hotels/:id
 */
const updateHotel = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findById(req.params.id);
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  const updated = await hotelService.updateHotel(req.params.id, req.body);
  return successResponse(res, 'Hotel updated successfully', { hotel: updated });
});

/**
 * POST /api/v1/buffet/admin/hotels/:id/verify
 */
const verifyHotel = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findById(req.params.id);
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);
  if (hotel.status !== 'approved') return errorResponse(res, 'Only approved hotels can be verified', 400);

  const updated = await hotelService.verifyHotel(req.params.id, req.user._id);

  // Send notification to hotel owner
  try {
    const notificationTrigger = require('../../services/notification/notification.trigger');
    await notificationTrigger.triggerHotelVerified(hotel.owner, updated);
  } catch (err) {
    console.error('[AdminHotelController] Verify notification error:', err.message);
  }

  return successResponse(res, 'Hotel verified and badge awarded', { hotel: updated });
});

/**
 * POST /api/v1/buffet/admin/hotels/:id/suspend
 */
const suspendHotel = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) return errorResponse(res, 'Suspension reason is required', 400);

  const hotel = await Hotel.findById(req.params.id);
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  const updated = await hotelService.suspendHotel(req.params.id, reason);

  return successResponse(res, 'Hotel suspended', { hotel: updated });
});

/**
 * POST /api/v1/buffet/admin/hotels/:id/approve
 * Approves a pending hotel (different from registration request approval).
 */
const approveHotel = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findById(req.params.id);
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);
  if (hotel.status !== 'pending') return errorResponse(res, 'Hotel is not in pending status', 400);

  const updated = await hotelService.updateHotel(req.params.id, {
    status: 'approved',
    isActive: true,
    rejectionReason: null,
  });

  return successResponse(res, 'Hotel approved and activated', { hotel: updated });
});

module.exports = {
  getRegistrations,
  getRegistration,
  approveRegistration,
  rejectRegistration,
  getHotels,
  getHotel,
  createHotel,
  updateHotel,
  verifyHotel,
  suspendHotel,
  approveHotel,
};

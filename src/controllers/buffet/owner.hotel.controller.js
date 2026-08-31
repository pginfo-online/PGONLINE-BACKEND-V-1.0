const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const Hotel = require('../../models/Hotel.model');
const HotelRegistrationRequest = require('../../models/HotelRegistrationRequest.model');
const hotelService = require('../../services/buffet/hotel.service');
const upload = require('../../middlewares/upload.middleware');

/**
 * Hotel Owner Controller — manage their own hotel profile, images, and location.
 *
 * All routes require: protect + isHotelOwner check.
 */

// ─── Helper ───────────────────────────────────────────────────────────────────

const getOwnerHotel = async (userId) => {
  return Hotel.findOne({ owner: userId })
    .populate('cityId', 'name slug')
    .populate('areaId', 'name slug');
};

// ─── Hotel Profile ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my
 */
const getMyHotel = asyncHandler(async (req, res) => {
  const hotel = await getOwnerHotel(req.user._id);
  if (!hotel) {
    return successResponse(res, 'No hotel found for this account', { hotel: null, hasHotel: false }, 200);
  }

  return successResponse(res, 'Hotel retrieved', { hotel, hasHotel: true });
});

/**
 * PUT /api/v1/buffet/hotel/my
 */
const updateMyHotel = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id });
  if (!hotel) return errorResponse(res, 'No hotel found for this account', 404);

  if (hotel.status === 'suspended') {
    return errorResponse(res, 'Your hotel account is suspended. Contact admin.', 403);
  }

  const allowedFields = [
    'name', 'description', 'tagline', 'contactPhone', 'contactEmail',
    'contactWhatsapp', 'website', 'address', 'fullAddress', 'landmark',
    'postalCode', 'latitude', 'longitude', 'googlePlaceId', 'googleMapsLink',
    'cuisine', 'foodType', 'seatingCapacity', 'facilities', 'parkingAvailable',
    'priceRange',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Update location GeoJSON if lat/lng provided
  if (updates.latitude && updates.longitude) {
    updates.location = {
      type: 'Point',
      coordinates: [Number(updates.longitude), Number(updates.latitude)],
    };
  }

  const updated = await hotelService.updateHotel(hotel._id, updates);
  return successResponse(res, 'Hotel updated successfully', { hotel: updated });
});

// ─── Images ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/buffet/hotel/my/images
 * Upload: logo | cover | gallery
 */
const uploadHotelImage = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id });
  if (!hotel) return errorResponse(res, 'No hotel found for this account', 404);

  if (!req.file) return errorResponse(res, 'No image file provided', 400);

  const imageType = req.body.type || 'gallery'; // logo | cover | gallery
  const { url, publicId } = await hotelService.uploadHotelImage(req.file.buffer, imageType, hotel._id);

  let update = {};
  if (imageType === 'logo') {
    // Delete old logo from Cloudinary
    if (hotel.logo?.publicId) {
      const { deleteFromCloudinary } = require('../../config/cloudinary');
      await deleteFromCloudinary(hotel.logo.publicId, 'image').catch(() => {});
    }
    update.logo = { url, publicId };
  } else if (imageType === 'cover') {
    if (hotel.coverImage?.publicId) {
      const { deleteFromCloudinary } = require('../../config/cloudinary');
      await deleteFromCloudinary(hotel.coverImage.publicId, 'image').catch(() => {});
    }
    update.coverImage = { url, publicId };
  } else {
    // Gallery — add to array
    const isMain = !hotel.gallery || hotel.gallery.length === 0;
    update.$push = { gallery: { url, publicId, isMain, caption: req.body.caption || '' } };
  }

  const updated = await Hotel.findByIdAndUpdate(hotel._id, update, { new: true }).lean();
  return successResponse(res, 'Image uploaded successfully', { hotel: updated, image: { url, publicId } });
});

/**
 * DELETE /api/v1/buffet/hotel/my/images/:publicId
 */
const deleteHotelImage = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id });
  if (!hotel) return errorResponse(res, 'No hotel found for this account', 404);

  const { publicId } = req.params;
  const imageType = req.query.type || 'gallery';

  const updated = await hotelService.deleteHotelImage(hotel, decodeURIComponent(publicId), imageType);
  return successResponse(res, 'Image deleted successfully', { hotel: updated });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/dashboard
 */
const getMyDashboard = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id }).lean();
  if (!hotel) {
    return successResponse(res, 'No hotel found for this account', {
      hotel: null,
      buffetStats: {},
      recentReservations: [],
      upcomingBuffets: [],
    });
  }

  const Buffet = require('../../models/Buffet.model');
  const BuffetReservation = require('../../models/BuffetReservation.model');

  const [buffetStats, recentReservations, upcomingBuffets] = await Promise.all([
    Buffet.aggregate([
      { $match: { hotel: hotel._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BuffetReservation.find({ hotel: hotel._id, status: 'reserved' })
      .populate('buffet', 'name date startTime')
      .populate('user', 'name phone')
      .sort({ reservedAt: -1 })
      .limit(5)
      .lean(),
    Buffet.find({
      hotel: hotel._id,
      status: { $in: ['live', 'scheduled', 'approved'] },
      expiresAt: { $gt: new Date() },
    })
      .sort({ date: 1 })
      .limit(5)
      .lean(),
  ]);

  const statsMap = {};
  for (const s of buffetStats) statsMap[s._id] = s.count;

  return successResponse(res, 'Dashboard retrieved', {
    hotel: {
      _id: hotel._id,
      name: hotel.name,
      status: hotel.status,
      isVerified: hotel.isVerified,
      avgRating: hotel.avgRating,
      reviewCount: hotel.reviewCount,
      activeBuffets: hotel.activeBuffets,
      views: hotel.views,
    },
    buffetStats: statsMap,
    recentReservations,
    upcomingBuffets,
  });
});

// ─── Hotel Registration (any user) ────────────────────────────────────────────

/**
 * POST /api/v1/buffet/hotel-registration
 * Any logged-in user can request to become a hotel partner.
 */
const submitRegistrationRequest = asyncHandler(async (req, res) => {
  // Check if user already has a hotel
  const existingHotel = await Hotel.findOne({ owner: req.user._id }).lean();
  if (existingHotel) {
    return errorResponse(res, 'You already have a registered hotel', 409);
  }

  // Check if user already has a pending request
  const existingRequest = await HotelRegistrationRequest.findOne({
    user: req.user._id,
    status: { $in: ['pending', 'under_review'] },
  }).lean();
  if (existingRequest) {
    return errorResponse(res, 'You already have a pending registration request', 409);
  }

  const { ownerName, mobileNumber, hotelName, cityId, city, areaId, area, address, latitude, longitude } = req.body;

  const request = await HotelRegistrationRequest.create({
    user: req.user._id,
    ownerName,
    mobileNumber,
    hotelName,
    cityId,
    city,
    areaId,
    area,
    address,
    latitude,
    longitude,
  });

  return successResponse(
    res,
    'Registration request submitted. We will review your application and notify you within 2-3 business days.',
    { request: { _id: request._id, status: request.status } },
    201
  );
});

/**
 * GET /api/v1/buffet/hotel-registration/status
 * Check the status of current user's registration request.
 */
const getRegistrationStatus = asyncHandler(async (req, res) => {
  const request = await HotelRegistrationRequest.findOne({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  if (!request) return errorResponse(res, 'No registration request found', 404);
  return successResponse(res, 'Registration status retrieved', { request });
});

module.exports = {
  getMyHotel,
  updateMyHotel,
  uploadHotelImage,
  deleteHotelImage,
  getMyDashboard,
  submitRegistrationRequest,
  getRegistrationStatus,
};

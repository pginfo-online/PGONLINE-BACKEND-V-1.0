const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Buffet = require('../../models/Buffet.model');
const BuffetMenu = require('../../models/BuffetMenu.model');
const Hotel = require('../../models/Hotel.model');
const buffetService = require('../../services/buffet/buffet.service');
const hotelService = require('../../services/buffet/hotel.service');

/**
 * Public Buffet Controller — unauthenticated discovery endpoints.
 *
 * All routes are public (no auth required).
 * Enforces: status='live', isActive=true, expiresAt > now.
 */

/**
 * GET /api/v1/buffet/discover
 * Query: city, area, date, minPrice, maxPrice, cuisine, type, foodType, sort, page, limit
 */
const discoverBuffets = asyncHandler(async (req, res) => {
  const { buffets, pagination } = await buffetService.discoverBuffets(req.query);

  // Increment view count for returned buffets (fire and forget)
  if (buffets.length > 0) {
    const ids = buffets.map((b) => b._id);
    Buffet.updateMany({ _id: { $in: ids } }, { $inc: { views: 1 } }).catch(() => {});
  }

  return paginatedResponse(res, 'Buffets discovered', buffets, pagination);
});

/**
 * GET /api/v1/buffet/:id — Single buffet detail
 */
const getBuffet = asyncHandler(async (req, res) => {
  const buffet = await Buffet.findById(req.params.id)
    .populate('hotel', 'name city area address contactPhone contactWhatsapp googleMapsLink avgRating isVerified coverImage logo gallery facilities foodType seatingCapacity cuisine')
    .lean();

  if (!buffet) return errorResponse(res, 'Buffet not found', 404);

  // Only public users see live buffets (unless they're the owner/admin — checked by later auth middleware)
  if (buffet.status !== 'live' || !buffet.isActive) {
    return errorResponse(res, 'This buffet is not currently available', 404);
  }

  if (buffet.expiresAt && buffet.expiresAt < new Date()) {
    return errorResponse(res, 'This buffet has expired', 404);
  }

  // Increment views
  Buffet.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).catch(() => {});

  // Attach promotions
  const BuffetPromotion = require('../../models/BuffetPromotion.model');
  const promotions = await BuffetPromotion.find({
    buffet: buffet._id,
    isActive: true,
    $or: [{ validUntil: null }, { validUntil: { $gt: new Date() } }],
  }).lean();

  return successResponse(res, 'Buffet retrieved', { buffet, promotions });
});

/**
 * GET /api/v1/buffet/:id/menu — Buffet menu (public)
 */
const getBuffetMenu = asyncHandler(async (req, res) => {
  // Verify buffet is live
  const buffet = await Buffet.findById(req.params.id).lean();
  if (!buffet || buffet.status !== 'live') {
    return errorResponse(res, 'Buffet not found or not available', 404);
  }

  const menu = await BuffetMenu.findOne({ buffet: req.params.id, isPublished: true }).lean();
  if (!menu) return errorResponse(res, 'No menu published for this buffet', 404);

  return successResponse(res, 'Menu retrieved', { menu });
});

/**
 * GET /api/v1/buffet/hotels/:id — Hotel public profile
 */
const getHotel = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ _id: req.params.id, status: 'approved', isActive: true })
    .select('-owner -registrationRequest -__v')
    .lean();

  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  // Increment views
  Hotel.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).catch(() => {});

  return successResponse(res, 'Hotel retrieved', { hotel });
});

/**
 * GET /api/v1/buffet/hotels/:id/buffets — Hotel's active buffets
 */
const getHotelBuffets = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ _id: req.params.id, status: 'approved', isActive: true }).lean();
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  const now = new Date();
  const buffets = await Buffet.find({
    hotel: hotel._id,
    status: 'live',
    isActive: true,
    expiresAt: { $gt: now },
  })
    .sort({ date: 1 })
    .lean();

  return successResponse(res, 'Hotel buffets retrieved', { hotel: { name: hotel.name, _id: hotel._id }, buffets });
});

/**
 * GET /api/v1/buffet/areas/:cityId — Areas by city (for mobile city+area selector)
 */
const getAreasByCity = asyncHandler(async (req, res) => {
  const Area = require('../../models/Area.model');
  const areas = await Area.find({ city: req.params.cityId, isActive: true })
    .sort({ order: 1, name: 1 })
    .select('name slug order')
    .lean();

  return successResponse(res, 'Areas retrieved', { areas });
});

module.exports = {
  discoverBuffets,
  getBuffet,
  getBuffetMenu,
  getHotel,
  getHotelBuffets,
  getAreasByCity,
};

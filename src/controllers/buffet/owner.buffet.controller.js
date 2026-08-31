const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Buffet = require('../../models/Buffet.model');
const BuffetMenu = require('../../models/BuffetMenu.model');
const BuffetReservation = require('../../models/BuffetReservation.model');
const BuffetPromotion = require('../../models/BuffetPromotion.model');
const WeeklyBuffetPlan = require('../../models/WeeklyBuffetPlan.model');
const Hotel = require('../../models/Hotel.model');
const buffetService = require('../../services/buffet/buffet.service');
const { uploadToCloudinary, deleteFromCloudinary } = require('../../config/cloudinary');

/**
 * Hotel Owner Buffet Controller — full buffet management for hotel owners.
 *
 * All routes require: protect + isHotelOwner check.
 */

// ─── Helper ───────────────────────────────────────────────────────────────────

const getOwnerHotelOrFail = async (userId, res) => {
  const hotel = await Hotel.findOne({ owner: userId, status: { $ne: 'suspended' } }).lean();
  if (!hotel) {
    errorResponse(res, 'Hotel not found or suspended', 404);
    return null;
  }
  if (hotel.status !== 'approved') {
    errorResponse(res, 'Your hotel must be approved before managing buffets', 403);
    return null;
  }
  return hotel;
};

const getOwnerBuffetOrFail = async (buffetId, ownerId, res) => {
  const buffet = await Buffet.findOne({ _id: buffetId, owner: ownerId });
  if (!buffet) {
    errorResponse(res, 'Buffet not found', 404);
    return null;
  }
  return buffet;
};

// ─── Buffets ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/buffets
 */
const getMyBuffets = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id, status: { $ne: 'suspended' } }).lean();
  if (!hotel) {
    return paginatedResponse(res, 'No hotel found for this account', [], {
      total: 0, page: Number(req.query.page || 1), limit: Number(req.query.limit || 20), pages: 0,
    });
  }

  const { status, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = { hotel: hotel._id };
  if (status) query.status = status;

  const [buffets, total] = await Promise.all([
    Buffet.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Buffet.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Buffets retrieved', buffets, {
    total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * GET /api/v1/buffet/hotel/my/buffets/:id
 */
const getMyBuffet = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const [menu, reservationCount] = await Promise.all([
    BuffetMenu.findOne({ buffet: buffet._id }).lean(),
    BuffetReservation.countDocuments({ buffet: buffet._id }),
  ]);

  return successResponse(res, 'Buffet retrieved', { buffet, menu, reservationCount });
});

/**
 * POST /api/v1/buffet/hotel/my/buffets — Create buffet (draft)
 */
const createMyBuffet = asyncHandler(async (req, res) => {
  const hotel = await getOwnerHotelOrFail(req.user._id, res);
  if (!hotel) return;

  const buffet = await buffetService.createBuffet(req.body, hotel, req.user._id);
  return successResponse(res, 'Buffet created as draft', { buffet }, 201);
});

/**
 * PUT /api/v1/buffet/hotel/my/buffets/:id — Edit buffet (draft/rejected only)
 */
const updateMyBuffet = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  try {
    const updated = await buffetService.updateBuffet(buffet, req.body, req.user._id);
    return successResponse(res, 'Buffet updated successfully', { buffet: updated });
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/submit — Submit for admin review
 */
const submitMyBuffet = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  try {
    const updated = await buffetService.submitBuffet(buffet, req.user._id);
    return successResponse(res, 'Buffet submitted for admin review', { buffet: updated });
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/pause — Pause live buffet
 */
const pauseMyBuffet = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  try {
    const updated = await buffetService.pauseBuffet(buffet, req.user._id);
    return successResponse(res, 'Buffet paused', { buffet: updated });
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/cancel
 */
const cancelMyBuffet = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  try {
    const updated = await buffetService.cancelBuffet(buffet, req.user._id, req.body.reason);
    return successResponse(res, 'Buffet cancelled', { buffet: updated });
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
});

// ─── Menu ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/buffets/:id/menu
 */
const getMyBuffetMenu = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const menu = await BuffetMenu.findOne({ buffet: buffet._id }).lean();
  if (!menu) return errorResponse(res, 'No menu found for this buffet', 404);

  return successResponse(res, 'Menu retrieved', { menu });
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/menu — Create or replace menu
 */
const upsertMyBuffetMenu = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const { sections } = req.body;
  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return errorResponse(res, 'At least one menu section is required', 400);
  }

  const menu = await BuffetMenu.findOneAndUpdate(
    { buffet: buffet._id },
    {
      buffet: buffet._id,
      hotel: buffet.hotel,
      owner: req.user._id,
      sections,
      isPublished: true,
      lastPublishedAt: new Date(),
    },
    { upsert: true, new: true, runValidators: true }
  );

  return successResponse(res, 'Menu saved successfully', { menu });
});

// ─── Images ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/images
 */
const uploadBuffetImage = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  if (!req.file) return errorResponse(res, 'No image file provided', 400);

  const { url, publicId } = await buffetService.uploadBuffetImage(req.file.buffer, buffet._id);
  const isMain = buffet.images.length === 0;

  buffet.images.push({ url, publicId, isMain, caption: req.body.caption || '' });
  await buffet.save();

  return successResponse(res, 'Image uploaded', { image: { url, publicId }, buffet });
});

/**
 * DELETE /api/v1/buffet/hotel/my/buffets/:buffetId/images/:publicId
 */
const deleteBuffetImage = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.buffetId, req.user._id, res);
  if (!buffet) return;

  const updated = await buffetService.deleteBuffetImage(buffet, decodeURIComponent(req.params.publicId));
  return successResponse(res, 'Image deleted', { buffet: updated });
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/menu/items/:itemId/image
 * Upload or replace the image for a specific menu item.
 */
const uploadMenuItemImage = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  if (!req.file) return errorResponse(res, 'No image file provided', 400);

  const menu = await BuffetMenu.findOne({ buffet: buffet._id });
  if (!menu) return errorResponse(res, 'No menu found for this buffet — save a menu first', 404);

  // Search all sections for the itemId
  let foundItem = null;
  for (const section of menu.sections) {
    const item = section.items.id(req.params.itemId);
    if (item) { foundItem = item; break; }
  }
  if (!foundItem) return errorResponse(res, 'Menu item not found', 404);

  // Delete existing Cloudinary asset if present
  if (foundItem.image?.publicId) {
    deleteFromCloudinary(foundItem.image.publicId).catch(() => {});
  }

  // Upload new image to Cloudinary
  const { uploadToCloudinary: upload } = require('../../config/cloudinary');
  const result = await upload(req.file.buffer, 'pginfo/buffet-menu-items');

  foundItem.image = { url: result.secure_url, publicId: result.public_id };
  await menu.save();

  return successResponse(res, 'Menu item image uploaded', {
    image: { url: result.secure_url, publicId: result.public_id },
    itemId: req.params.itemId,
  });
});

/**
 * DELETE /api/v1/buffet/hotel/my/buffets/:id/menu/items/:itemId/image
 * Remove the image from a menu item.
 */
const deleteMenuItemImage = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const menu = await BuffetMenu.findOne({ buffet: buffet._id });
  if (!menu) return errorResponse(res, 'No menu found', 404);

  let foundItem = null;
  for (const section of menu.sections) {
    const item = section.items.id(req.params.itemId);
    if (item) { foundItem = item; break; }
  }
  if (!foundItem) return errorResponse(res, 'Menu item not found', 404);

  if (foundItem.image?.publicId) {
    deleteFromCloudinary(foundItem.image.publicId).catch(() => {});
  }
  foundItem.image = { url: null, publicId: null };
  await menu.save();

  return successResponse(res, 'Menu item image removed', { itemId: req.params.itemId });
});



// ─── Reservations ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/buffets/:id/reservations
 */
const getBuffetReservations = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const reservations = await BuffetReservation.find({ buffet: buffet._id })
    .populate('user', 'name phone email')
    .sort({ reservedAt: -1 })
    .lean();

  return successResponse(res, 'Reservations retrieved', { reservations });
});

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/buffet/hotel/my/weekly-plan — Create weekly buffet plan
 */
const createWeeklyPlan = asyncHandler(async (req, res) => {
  const hotel = await getOwnerHotelOrFail(req.user._id, res);
  if (!hotel) return;

  const { weekStartDate, weekEndDate, buffets: buffetDataArray } = req.body;

  if (!buffetDataArray || buffetDataArray.length === 0) {
    return errorResponse(res, 'At least one buffet is required in the weekly plan', 400);
  }

  // Create each buffet as draft + link to plan
  const plan = new WeeklyBuffetPlan({
    hotel: hotel._id,
    owner: req.user._id,
    weekStartDate,
    weekEndDate,
    weekLabel: `Week of ${new Date(weekStartDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    status: 'draft',
  });
  await plan.save();

  const createdBuffets = [];
  for (const buffetData of buffetDataArray) {
    const buffet = await buffetService.createBuffet(buffetData, hotel, req.user._id);
    buffet.isWeeklyPlan = true;
    buffet.weeklyPlanId = plan._id;
    buffet.status = 'submitted'; // auto-submit as part of plan
    buffet.statusHistory.push({ status: 'submitted', changedBy: req.user._id, changedAt: new Date(), reason: 'submitted via weekly plan' });
    await buffet.save();
    createdBuffets.push(buffet._id);
  }

  plan.buffets = createdBuffets;
  plan.status = 'submitted';
  plan.submittedAt = new Date();
  await plan.save();

  return successResponse(res, 'Weekly plan submitted for admin review', { plan, buffetsCreated: createdBuffets.length }, 201);
});

/**
 * GET /api/v1/buffet/hotel/my/weekly-plans
 */
const getMyWeeklyPlans = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id }).lean();
  if (!hotel) return errorResponse(res, 'Hotel not found', 404);

  const plans = await WeeklyBuffetPlan.find({ hotel: hotel._id })
    .populate('buffets', 'name date type status')
    .sort({ weekStartDate: -1 })
    .lean();

  return successResponse(res, 'Weekly plans retrieved', { plans });
});

// ─── Promotions ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/buffets/:id/promotions
 */
const getMyPromotions = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const promotions = await BuffetPromotion.find({ buffet: buffet._id }).lean();
  return successResponse(res, 'Promotions retrieved', { promotions });
});

/**
 * POST /api/v1/buffet/hotel/my/buffets/:id/promotions
 */
const createPromotion = asyncHandler(async (req, res) => {
  const buffet = await getOwnerBuffetOrFail(req.params.id, req.user._id, res);
  if (!buffet) return;

  const hotel = await Hotel.findOne({ owner: req.user._id }).lean();

  const promotion = await BuffetPromotion.create({
    ...req.body,
    buffet: buffet._id,
    hotel: hotel._id,
    owner: req.user._id,
  });

  // Update buffet originalPrice if promo reduces price
  if (promotion.finalPrice < buffet.pricePerPerson) {
    buffet.originalPrice = buffet.pricePerPerson;
    await buffet.save();
  }

  return successResponse(res, 'Promotion created', { promotion }, 201);
});

/**
 * PUT /api/v1/buffet/promotions/:id
 */
const updatePromotion = asyncHandler(async (req, res) => {
  const promotion = await BuffetPromotion.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });
  if (!promotion) return errorResponse(res, 'Promotion not found', 404);

  Object.assign(promotion, req.body);
  await promotion.save();

  return successResponse(res, 'Promotion updated', { promotion });
});

/**
 * DELETE /api/v1/buffet/promotions/:id
 */
const deletePromotion = asyncHandler(async (req, res) => {
  const promotion = await BuffetPromotion.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });
  if (!promotion) return errorResponse(res, 'Promotion not found', 404);

  await promotion.deleteOne();
  return successResponse(res, 'Promotion deleted');
});

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/buffet/hotel/my/analytics
 */
const getMyAnalytics = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findOne({ owner: req.user._id }).lean();
  if (!hotel) {
    return successResponse(res, 'No hotel found for this account', {
      hotel: null,
      buffetStats: {},
      reservationStats: {},
      totalGuestsServed: 0,
      topBuffets: [],
    });
  }

  const [buffetStats, reservationStats, topBuffets] = await Promise.all([
    Buffet.aggregate([
      { $match: { hotel: hotel._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BuffetReservation.aggregate([
      { $match: { hotel: hotel._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalPartySize: { $sum: '$partySize' },
        },
      },
    ]),
    Buffet.find({ hotel: hotel._id })
      .sort({ reservations: -1 })
      .limit(5)
      .select('name date type reservations views pricePerPerson status')
      .lean(),
  ]);

  const buffetMap = {};
  for (const s of buffetStats) buffetMap[s._id] = s.count;

  const reservationMap = {};
  let totalGuests = 0;
  for (const s of reservationStats) {
    reservationMap[s._id] = { count: s.count, guests: s.totalPartySize };
    if (s._id === 'completed') totalGuests += s.totalPartySize;
  }

  return successResponse(res, 'Analytics retrieved', {
    hotel: {
      avgRating: hotel.avgRating,
      reviewCount: hotel.reviewCount,
      views: hotel.views,
      activeBuffets: hotel.activeBuffets,
      totalBuffets: hotel.totalBuffets,
    },
    buffetStats: buffetMap,
    reservationStats: reservationMap,
    totalGuestsServed: totalGuests,
    topBuffets,
  });
});

module.exports = {
  getMyBuffets,
  getMyBuffet,
  createMyBuffet,
  updateMyBuffet,
  submitMyBuffet,
  pauseMyBuffet,
  cancelMyBuffet,
  getMyBuffetMenu,
  upsertMyBuffetMenu,
  uploadBuffetImage,
  deleteBuffetImage,
  getBuffetReservations,
  createWeeklyPlan,
  getMyWeeklyPlans,
  getMyPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  getMyAnalytics,
  uploadMenuItemImage,
  deleteMenuItemImage,
};


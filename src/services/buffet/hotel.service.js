const Hotel = require('../../models/Hotel.model');
const HotelRegistrationRequest = require('../../models/HotelRegistrationRequest.model');
const User = require('../../models/User.model');
const { uploadToCloudinary, deleteFromCloudinary } = require('../../config/cloudinary');

/**
 * hotel.service.js — Core hotel business logic
 *
 * Used by both admin and hotel-owner controllers.
 * Handles CRUD, image management, verification, and status transitions.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Update hotel priceRange based on its active buffets.
 * Called after buffets are created/updated.
 */
const syncHotelPriceRange = async (hotelId) => {
  const Buffet = require('../../models/Buffet.model');
  const result = await Buffet.aggregate([
    { $match: { hotel: hotelId, status: { $in: ['approved', 'scheduled', 'live'] }, isActive: true } },
    {
      $group: {
        _id: null,
        min: { $min: '$pricePerPerson' },
        max: { $max: '$pricePerPerson' },
        activeCount: { $sum: 1 },
      },
    },
  ]);

  if (result.length > 0) {
    await Hotel.findByIdAndUpdate(hotelId, {
      'priceRange.min': result[0].min,
      'priceRange.max': result[0].max,
      activeBuffets: result[0].activeCount,
    });
  }
};

/**
 * Recalculate hotel avgRating and reviewCount from BuffetReview.
 */
const syncHotelRating = async (hotelId) => {
  const BuffetReview = require('../../models/BuffetReview.model');
  const result = await BuffetReview.aggregate([
    { $match: { hotel: hotelId, isVisible: true } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = result.length > 0 ? Math.round(result[0].avgRating * 10) / 10 : 0;
  const count = result.length > 0 ? result[0].count : 0;
  await Hotel.findByIdAndUpdate(hotelId, { avgRating: avg, reviewCount: count });
};

// ─── Hotel CRUD ───────────────────────────────────────────────────────────────

/**
 * Get hotel by ID with optional populate.
 */
const getHotelById = async (hotelId, populate = false) => {
  let query = Hotel.findById(hotelId);
  if (populate) {
    query = query
      .populate('owner', 'name email phone')
      .populate('cityId', 'name slug')
      .populate('areaId', 'name slug');
  }
  return query.lean();
};

/**
 * Get hotel by owner ID.
 */
const getHotelByOwner = async (ownerId) => {
  return Hotel.findOne({ owner: ownerId })
    .populate('cityId', 'name slug')
    .populate('areaId', 'name slug')
    .lean();
};

/**
 * Create a new hotel (admin direct creation).
 */
const createHotel = async (data) => {
  const hotel = new Hotel({
    ...data,
    isActive: false, // not active until explicitly approved
    status: 'approved', // admin directly creating = pre-approved
    isActive: true,
  });
  await hotel.save();
  return hotel;
};

/**
 * Update hotel fields.
 */
const updateHotel = async (hotelId, updates) => {
  return Hotel.findByIdAndUpdate(
    hotelId,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
};

/**
 * Admin: approve hotel registration request, create hotel, grant role.
 */
const approveRegistration = async (requestId, adminId) => {
  const request = await HotelRegistrationRequest.findById(requestId).lean();
  if (!request) throw new Error('Registration request not found');
  if (request.status === 'approved') throw new Error('Already approved');

  // Create the hotel
  const hotel = new Hotel({
    owner: request.user,
    name: request.hotelName,
    cityId: request.cityId,
    city: request.city,
    areaId: request.areaId,
    area: request.area || '',
    address: request.address,
    latitude: request.latitude,
    longitude: request.longitude,
    ...(request.latitude && request.longitude
      ? { location: { type: 'Point', coordinates: [request.longitude, request.latitude] } }
      : {}),
    contactPhone: request.mobileNumber,
    status: 'approved',
    isActive: true,
    registrationRequest: requestId,
  });
  await hotel.save();

  // Grant hotel_owner role to user
  await User.findByIdAndUpdate(request.user, {
    isHotelOwner: true,
    role: 'hotel_owner',
  });

  // Update registration request
  await HotelRegistrationRequest.findByIdAndUpdate(requestId, {
    status: 'approved',
    reviewedBy: adminId,
    reviewedAt: new Date(),
    createdHotel: hotel._id,
    notifiedAt: new Date(),
  });

  return { hotel, userId: request.user };
};

/**
 * Admin: reject hotel registration request.
 */
const rejectRegistration = async (requestId, adminId, rejectionReason) => {
  const request = await HotelRegistrationRequest.findById(requestId);
  if (!request) throw new Error('Registration request not found');
  if (request.status === 'approved') throw new Error('Cannot reject an already approved request');

  request.status = 'rejected';
  request.reviewedBy = adminId;
  request.reviewedAt = new Date();
  request.rejectionReason = rejectionReason;
  await request.save();
  return request;
};

/**
 * Admin: verify hotel (award verified badge).
 */
const verifyHotel = async (hotelId, adminId) => {
  return Hotel.findByIdAndUpdate(
    hotelId,
    {
      isVerified: true,
      verifiedAt: new Date(),
      verifiedBy: adminId,
    },
    { new: true }
  ).lean();
};

/**
 * Admin: suspend hotel.
 */
const suspendHotel = async (hotelId, reason) => {
  return Hotel.findByIdAndUpdate(
    hotelId,
    { status: 'suspended', isActive: false, rejectionReason: reason },
    { new: true }
  ).lean();
};

// ─── Image Management ─────────────────────────────────────────────────────────

/**
 * Upload a hotel image (logo, coverImage, or gallery) to Cloudinary.
 */
const uploadHotelImage = async (buffer, type = 'gallery', hotelId) => {
  const folder = `pginfo/hotels/${hotelId}`;
  const result = await uploadToCloudinary(buffer, folder, 'image');
  return { url: result.secure_url, publicId: result.public_id };
};

/**
 * Delete a hotel image from Cloudinary and remove from hotel document.
 */
const deleteHotelImage = async (hotel, publicId, imageType) => {
  try {
    await deleteFromCloudinary(publicId, 'image');
  } catch (err) {
    console.error('[HotelService] Cloudinary delete error:', err.message);
  }

  const update = {};
  if (imageType === 'logo') {
    update.logo = { url: null, publicId: null };
  } else if (imageType === 'cover') {
    update.coverImage = { url: null, publicId: null };
  } else {
    update.$pull = { gallery: { publicId } };
  }

  return Hotel.findByIdAndUpdate(hotel._id, update, { new: true }).lean();
};

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Build hotel query for public listing.
 */
const buildHotelDiscoveryQuery = (params) => {
  const query = {
    status: 'approved',
    isActive: true,
  };

  if (params.city) query.city = params.city;
  if (params.area) {
    query.area = { $regex: new RegExp(`^${params.area.trim()}$`, 'i') };
  }
  if (params.isVerified === 'true') query.isVerified = true;
  if (params.foodType) query.foodType = params.foodType;

  return query;
};

module.exports = {
  getHotelById,
  getHotelByOwner,
  createHotel,
  updateHotel,
  approveRegistration,
  rejectRegistration,
  verifyHotel,
  suspendHotel,
  uploadHotelImage,
  deleteHotelImage,
  syncHotelPriceRange,
  syncHotelRating,
  buildHotelDiscoveryQuery,
};

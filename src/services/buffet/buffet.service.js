const Buffet = require('../../models/Buffet.model');
const BuffetMenu = require('../../models/BuffetMenu.model');
const BuffetReservation = require('../../models/BuffetReservation.model');
const Hotel = require('../../models/Hotel.model');
const { uploadToCloudinary, deleteFromCloudinary } = require('../../config/cloudinary');

/**
 * buffet.service.js — Core buffet business logic.
 *
 * Handles creation, lifecycle transitions, discovery queries,
 * capacity management, image uploads, and status history tracking.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute expiresAt from date + endTime string ('HH:mm').
 * Adds 30-minute grace period.
 */
const computeExpiresAt = (dateValue, endTime) => {
  const [hours, minutes] = endTime.split(':').map(Number);
  const d = new Date(dateValue);
  d.setUTCHours(hours, minutes, 0, 0);
  d.setMinutes(d.getMinutes() + 30);
  return d;
};

/**
 * Push a status history entry.
 */
const pushStatusHistory = (buffet, status, userId, reason = null) => {
  buffet.statusHistory.push({
    status,
    changedBy: userId,
    changedAt: new Date(),
    reason,
  });
  buffet.status = status;
};

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Build MongoDB query for public buffet discovery.
 * Enforces: status='live', isActive=true, expiresAt > now.
 */
const buildDiscoveryQuery = (params) => {
  const now = new Date();
  const query = {
    status: 'live',
    isActive: true,
    expiresAt: { $gt: now },
  };

  if (params.city) {
    query.city = { $regex: new RegExp(`^${params.city.trim()}$`, 'i') };
  }

  if (params.search && params.search.trim()) {
    const s = params.search.trim();
    query.$or = [
      { name: { $regex: s, $options: 'i' } },
      { cuisine: { $regex: s, $options: 'i' } },
      { area: { $regex: s, $options: 'i' } },
    ];
  }

  if (params.area) {
    const areas = String(params.area)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (areas.length === 1) {
      query.area = { $regex: new RegExp(`^${areas[0]}$`, 'i') };
    } else if (areas.length > 1) {
      query.area = { $in: areas.map((a) => new RegExp(`^${a}$`, 'i')) };
    }
  }

  if (params.date) {
    const d = new Date(params.date);
    const start = new Date(d.setUTCHours(0, 0, 0, 0));
    const end = new Date(d.setUTCHours(23, 59, 59, 999));
    query.date = { $gte: start, $lte: end };
  }

  if (params.minPrice || params.maxPrice) {
    query.pricePerPerson = {};
    if (params.minPrice) query.pricePerPerson.$gte = Number(params.minPrice);
    if (params.maxPrice) query.pricePerPerson.$lte = Number(params.maxPrice);
  }

  if (params.cuisine) {
    const cuisines = String(params.cuisine).split(',').map((c) => c.trim()).filter(Boolean);
    if (cuisines.length > 0) query.cuisine = { $in: cuisines };
  }

  if (params.type) query.type = params.type;
  if (params.foodType) query.foodType = params.foodType;

  // Capacity availability filter
  if (params.availableOnly === 'true') {
    query.$or = [
      { maxCapacity: null },
      { $expr: { $lt: ['$reservedCount', '$maxCapacity'] } },
    ];
  }

  return query;
};

/**
 * Get discover buffets with pagination.
 */
const discoverBuffets = async (params) => {
  const query = buildDiscoveryQuery(params);
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit) || 12));
  const skip = (page - 1) * limit;

  const sortMap = {
    price_asc: { pricePerPerson: 1 },
    price_desc: { pricePerPerson: -1 },
    date: { date: 1 },
    rating: { 'hotel.avgRating': -1 },
    newest: { createdAt: -1 },
  };
  const sort = sortMap[params.sort] || { date: 1, createdAt: -1 };

  const [buffets, total] = await Promise.all([
    Buffet.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('hotel', 'name city area address contactPhone avgRating isVerified coverImage logo mainPhotoUrl')
      .lean(),
    Buffet.countDocuments(query),
  ]);

  return {
    buffets,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Get buffet by ID with optional hotel populate.
 */
const getBuffetById = async (buffetId, includeHotel = false) => {
  let query = Buffet.findById(buffetId);
  if (includeHotel) {
    query = query.populate('hotel', 'name city area address contactPhone avgRating isVerified coverImage logo facilities');
  }
  return query.lean();
};

/**
 * Create a new buffet in draft status.
 */
const createBuffet = async (data, hotel, userId) => {
  const expiresAt = data.endTime ? computeExpiresAt(data.date, data.endTime) : null;

  const buffet = new Buffet({
    ...data,
    hotel: hotel._id,
    owner: userId,
    city: hotel.city,
    area: hotel.area,
    cityId: hotel.cityId,
    areaId: hotel.areaId,
    status: 'draft',
    expiresAt,
    statusHistory: [{ status: 'draft', changedBy: userId, changedAt: new Date() }],
  });

  await buffet.save();

  // Increment hotel totalBuffets
  await Hotel.findByIdAndUpdate(hotel._id, { $inc: { totalBuffets: 1 } });

  return buffet;
};

/**
 * Update a buffet.
 */
const updateBuffet = async (buffet, updates, userId) => {
  if (['completed', 'cancelled'].includes(buffet.status)) {
    throw new Error('Completed or cancelled buffets cannot be edited');
  }

  Object.assign(buffet, updates);

  // Recompute expiresAt if date or endTime changed
  if ((updates.date || updates.endTime) && buffet.date && buffet.endTime) {
    buffet.expiresAt = computeExpiresAt(buffet.date, buffet.endTime);
  }

  await buffet.save();
  return buffet;
};

/**
 * Submit buffet for admin review.
 */
const submitBuffet = async (buffet, userId) => {
  if (['completed', 'cancelled'].includes(buffet.status)) {
    throw new Error('Completed or cancelled buffets cannot be submitted for review');
  }

  if (buffet.status !== 'submitted') {
    pushStatusHistory(buffet, 'submitted', userId);
    await buffet.save();
  }

  return buffet;
};


/**
 * Admin: approve a buffet.
 */
const approveBuffet = async (buffet, adminId) => {
  if (!['submitted', 'under_review'].includes(buffet.status)) {
    throw new Error('Only submitted or under_review buffets can be approved');
  }

  const now = new Date();
  const buffetDate = new Date(buffet.date);
  const newStatus = buffetDate <= now ? 'live' : 'scheduled';

  pushStatusHistory(buffet, newStatus, adminId);
  buffet.approvedBy = adminId;
  buffet.approvedAt = now;

  await buffet.save();

  // Sync hotel price range
  const { syncHotelPriceRange } = require('./hotel.service');
  await syncHotelPriceRange(buffet.hotel);

  return buffet;
};

/**
 * Admin: reject a buffet.
 */
const rejectBuffet = async (buffet, adminId, reason) => {
  if (!['submitted', 'under_review'].includes(buffet.status)) {
    throw new Error('Only submitted or under_review buffets can be rejected');
  }
  pushStatusHistory(buffet, 'rejected', adminId, reason);
  buffet.rejectionReason = reason;
  await buffet.save();
  return buffet;
};

/**
 * Owner: pause a live buffet.
 */
const pauseBuffet = async (buffet, userId) => {
  if (buffet.status !== 'live') throw new Error('Only live buffets can be paused');
  pushStatusHistory(buffet, 'paused', userId);
  await buffet.save();
  return buffet;
};

/**
 * Owner: cancel a buffet.
 */
const cancelBuffet = async (buffet, userId, reason) => {
  if (['completed', 'cancelled'].includes(buffet.status)) {
    throw new Error('Cannot cancel a completed or already cancelled buffet');
  }
  pushStatusHistory(buffet, 'cancelled', userId, reason);
  buffet.isActive = false;
  await buffet.save();
  return buffet;
};

// ─── Capacity ─────────────────────────────────────────────────────────────────

/**
 * Check if buffet has capacity for the given party size.
 */
const checkCapacity = (buffet, partySize) => {
  if (buffet.maxCapacity === null || buffet.maxCapacity === undefined) return true;
  const available = buffet.maxCapacity - (buffet.reservedCount || 0);
  return available >= partySize;
};

/**
 * Increment reservedCount (atomic).
 */
const incrementReservations = async (buffetId, partySize) => {
  await Buffet.findByIdAndUpdate(buffetId, {
    $inc: { reservedCount: partySize, reservations: 1 },
  });
};

/**
 * Decrement reservedCount (on cancellation).
 */
const decrementReservations = async (buffetId, partySize) => {
  await Buffet.findByIdAndUpdate(buffetId, {
    $inc: { reservedCount: -partySize, reservations: -1 },
  });
};

// ─── Images ───────────────────────────────────────────────────────────────────

/**
 * Upload buffet image to Cloudinary.
 */
const uploadBuffetImage = async (buffer, buffetId) => {
  const folder = `pginfo/buffets/${buffetId}`;
  const result = await uploadToCloudinary(buffer, folder, 'image');
  return { url: result.secure_url, publicId: result.public_id };
};

/**
 * Delete buffet image from Cloudinary and document.
 */
const deleteBuffetImage = async (buffet, publicId) => {
  try {
    await deleteFromCloudinary(publicId, 'image');
  } catch (err) {
    console.error('[BuffetService] Cloudinary delete error:', err.message);
  }
  buffet.images = buffet.images.filter((img) => img.publicId !== publicId);
  await buffet.save();
  return buffet;
};

// ─── Admin list query ─────────────────────────────────────────────────────────

/**
 * Build query for admin buffet list.
 */
const buildAdminBuffetQuery = (params) => {
  const query = {};
  if (params.status) query.status = params.status;
  if (params.city) query.city = params.city;
  if (params.hotel) query.hotel = params.hotel;
  if (params.date) {
    const d = new Date(params.date);
    query.date = {
      $gte: new Date(d.setUTCHours(0, 0, 0, 0)),
      $lte: new Date(d.setUTCHours(23, 59, 59, 999)),
    };
  }
  return query;
};

module.exports = {
  buildDiscoveryQuery,
  discoverBuffets,
  getBuffetById,
  createBuffet,
  updateBuffet,
  submitBuffet,
  approveBuffet,
  rejectBuffet,
  pauseBuffet,
  cancelBuffet,
  checkCapacity,
  incrementReservations,
  decrementReservations,
  uploadBuffetImage,
  deleteBuffetImage,
  buildAdminBuffetQuery,
  computeExpiresAt,
};

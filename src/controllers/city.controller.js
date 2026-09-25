const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const City = require('../models/City.model');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Upload a city image to Cloudinary under pginfo/cities folder.
 * @param {Buffer} buffer
 * @returns {{ url, publicId }}
 */
const uploadCityImage = async (buffer) => {
  const result = await uploadToCloudinary(buffer, 'pginfo/cities', 'image');
  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/**
 * Delete a city image from Cloudinary (no-throw — logs error only).
 * @param {string|null} publicId
 */
const deleteCityImageSafe = async (publicId) => {
  if (!publicId) return;
  try {
    await deleteFromCloudinary(publicId, 'image');
  } catch (err) {
    console.error('[City] Cloudinary delete failed for publicId:', publicId, err.message);
  }
};

// ─── In-Memory Cache with TTL ────────────────────────────────────────────────
let _citiesCache = null;
let _citiesCacheTime = 0;
const CITIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const invalidateCityCache = () => {
  _citiesCache = null;
  _citiesCacheTime = 0;
};

// ─── Public Controllers ───────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/cities
 * @desc   Get active cities with server-side search, pagination, deduplication, and caching.
 * @access Public
 */
const getCities = asyncHandler(async (req, res) => {
  const { q, page: pageStr, limit: limitStr, popularOnly, all } = req.query;

  const isSearchOrPaginated = Boolean(q || pageStr || limitStr || popularOnly);
  const returnAll = all === 'true' || all === true;

  // Use fast in-memory cache for the default full list (when not searching or paginating)
  const now = Date.now();
  if (!isSearchOrPaginated && returnAll && _citiesCache && now - _citiesCacheTime < CITIES_CACHE_TTL) {
    return successResponse(res, 'Cities retrieved (cached)', {
      cities: _citiesCache,
      pagination: {
        total: _citiesCache.length,
        page: 1,
        limit: _citiesCache.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  }

  const filter = { isActive: true };

  if (q && q.trim().length > 0) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ name: regex }, { aliases: regex }, { state: regex }];
  }

  if (popularOnly === 'true' || popularOnly === true) {
    filter.order = { $lte: 20 };
  }

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = returnAll ? 200 : Math.min(100, Math.max(1, parseInt(limitStr, 10) || 24));
  const skip = (page - 1) * limit;

  const [rawCities, total] = await Promise.all([
    City.find(filter)
      .sort({ order: 1, name: 1 })
      .select('_id name slug image state country description order aliases')
      .skip(returnAll ? 0 : skip)
      .limit(limit)
      .lean(),
    City.countDocuments(filter),
  ]);

  // Defensive deduplication by normalized lowercase name
  const seenNames = new Set();
  const cities = [];
  for (const c of rawCities) {
    const norm = (c.name || '').trim().toLowerCase();
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      cities.push(c);
    }
  }

  // Update default cache if this was an unbounded request
  if (!isSearchOrPaginated && returnAll) {
    _citiesCache = cities;
    _citiesCacheTime = now;
  }

  const pagination = {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };

  successResponse(res, 'Cities retrieved', { cities, pagination });
});

/**
 * @route  GET /api/v1/cities/search?q=<text>&state=<state>&country=<country>
 * @desc   Fuzzy-search active cities by name or alias — used by CityAutocomplete
 *         and location resolve flow. Returns up to 20 matches.
 * @access Public
 */
const searchCities = asyncHandler(async (req, res) => {
  const { q, state, country, limit: limitStr } = req.query;

  const filter = { isActive: true };

  if (q && q.trim().length > 0) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ name: regex }, { aliases: regex }];
  }

  if (state && state.trim()) {
    filter.state = { $regex: new RegExp(state.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  }

  if (country && country.trim()) {
    filter.country = { $regex: new RegExp(country.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  }

  const limit = Math.min(50, Math.max(1, parseInt(limitStr, 10) || 20));

  const rawCities = await City.find(filter)
    .sort({ order: 1, name: 1 })
    .select('_id name slug image state country description order aliases')
    .limit(limit)
    .lean();

  // Deduplicate
  const seenNames = new Set();
  const cities = [];
  for (const c of rawCities) {
    const norm = (c.name || '').trim().toLowerCase();
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      cities.push(c);
    }
  }

  successResponse(res, 'City search results', { cities });
});

// ─── Admin Controllers ────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/cities/admin
 * @desc   Get ALL cities (active + inactive) for admin panel
 * @access Admin
 */
const getAllCitiesAdmin = asyncHandler(async (req, res) => {
  const cities = await City.find()
    .sort({ order: 1, name: 1 })
    .lean();

  successResponse(res, 'All cities retrieved', { cities });
});

/**
 * @route  POST /api/v1/cities
 * @desc   Create a new city with optional image upload
 * @access Admin
 * @body   multipart/form-data: name, state?, description?, isActive?, order?, image (file)?
 */
const createCity = asyncHandler(async (req, res) => {
  const { name, state, description, isActive, order } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'City name is required' });
  }

  // Check for duplicate name
  const existing = await City.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
  if (existing) {
    return res.status(400).json({ success: false, message: `City "${name.trim()}" already exists` });
  }

  let image = { url: null, publicId: null };

  // Upload image if provided
  if (req.file) {
    image = await uploadCityImage(req.file.buffer);
  }

  const city = await City.create({
    name: name.trim(),
    state: state?.trim(),
    description: description?.trim(),
    isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true,
    order: order !== undefined ? parseInt(order, 10) : 99,
    image,
  });

  invalidateCityCache();

  successResponse(res, 'City created successfully', { city }, 201);
});

/**
 * @route  PUT /api/v1/cities/:id
 * @desc   Update city details and/or replace image
 * @access Admin
 */
const updateCity = asyncHandler(async (req, res) => {
  const city = await City.findById(req.params.id);
  if (!city) {
    return res.status(404).json({ success: false, message: 'City not found' });
  }

  const { name, state, description, isActive, order } = req.body;

  // Check name uniqueness if being changed
  if (name && name.trim().toLowerCase() !== city.name.toLowerCase()) {
    const existing = await City.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      _id: { $ne: city._id },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: `City "${name.trim()}" already exists` });
    }
    city.name = name.trim();
  }

  if (state !== undefined) city.state = state.trim();
  if (description !== undefined) city.description = description.trim();
  if (isActive !== undefined) city.isActive = isActive === 'true' || isActive === true;
  if (order !== undefined) city.order = parseInt(order, 10);

  // Handle image replacement
  if (req.file) {
    const oldPublicId = city.image?.publicId;
    const newImage = await uploadCityImage(req.file.buffer);
    city.image = newImage;

    // Delete old Cloudinary image after successful upload
    await deleteCityImageSafe(oldPublicId);
  }

  await city.save();
  invalidateCityCache();

  successResponse(res, 'City updated successfully', { city });
});

/**
 * @route  DELETE /api/v1/cities/:id
 * @desc   Delete city and clean up Cloudinary image
 * @access Admin
 */
const deleteCity = asyncHandler(async (req, res) => {
  const city = await City.findById(req.params.id);
  if (!city) {
    return res.status(404).json({ success: false, message: 'City not found' });
  }

  // Clean up Cloudinary image first
  await deleteCityImageSafe(city.image?.publicId);

  await City.findByIdAndDelete(req.params.id);
  invalidateCityCache();

  successResponse(res, 'City deleted successfully');
});

/**
 * @route  PUT /api/v1/cities/:id/toggle-status
 * @desc   Toggle city active/inactive status
 * @access Admin
 */
const toggleCityStatus = asyncHandler(async (req, res) => {
  const city = await City.findById(req.params.id);
  if (!city) {
    return res.status(404).json({ success: false, message: 'City not found' });
  }

  city.isActive = !city.isActive;
  await city.save();
  invalidateCityCache();

  successResponse(res, `City ${city.isActive ? 'activated' : 'deactivated'}`, { city });
});

module.exports = {
  getCities,
  searchCities,
  getAllCitiesAdmin,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus,
};


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

// ─── Public Controllers ───────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/cities
 * @desc   Get all active cities sorted by order — consumed by mobile city selector
 * @access Public
 */
const getCities = asyncHandler(async (req, res) => {
  const cities = await City.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .select('name slug image state description order')
    .lean();

  successResponse(res, 'Cities retrieved', { cities });
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

  successResponse(res, `City ${city.isActive ? 'activated' : 'deactivated'}`, { city });
});

module.exports = {
  getCities,
  getAllCitiesAdmin,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus,
};

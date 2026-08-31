const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Area = require('../../models/Area.model');
const City = require('../../models/City.model');

/**
 * Admin Area Controller — complete CRUD for Area model.
 * Linked to City model for geographic hierarchy.
 */

// ─── GET /api/v1/buffet/admin/areas ─────────────────────────────────────────
const getAllAreas = asyncHandler(async (req, res) => {
  const { city, isActive, page = 1, limit = 100 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (city) query.city = city;
  if (isActive !== undefined) query.isActive = isActive === 'true';

  const [areas, total] = await Promise.all([
    Area.find(query)
      .populate('city', 'name slug')
      .sort({ isActive: -1, order: 1, name: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Area.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Areas retrieved', areas, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
  });
});

// ─── GET /api/v1/buffet/areas/:cityId (Public) ────────────────────────────────
const getAreasByCity = asyncHandler(async (req, res) => {
  const { cityId } = req.params;
  const areas = await Area.find({ city: cityId, isActive: true })
    .sort({ order: 1, name: 1 })
    .select('name slug order')
    .lean();

  return successResponse(res, 'Areas retrieved', { areas });
});

// ─── POST /api/v1/buffet/admin/areas ──────────────────────────────────────────
const createArea = asyncHandler(async (req, res) => {
  const { city, name, description, isActive, order } = req.body;

  // Validate city exists
  const cityDoc = await City.findById(city).lean();
  if (!cityDoc) return errorResponse(res, 'City not found', 404);

  // Check duplicate name within city
  const existing = await Area.findOne({
    city,
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
  });
  if (existing) return errorResponse(res, `Area "${name}" already exists in ${cityDoc.name}`, 409);

  const area = await Area.create({
    city,
    cityName: cityDoc.name,
    name: name.trim(),
    description,
    isActive: isActive !== false,
    order: order ?? 99,
  });

  return successResponse(res, 'Area created successfully', { area }, 201);
});

// ─── PUT /api/v1/buffet/admin/areas/:id ───────────────────────────────────────
const updateArea = asyncHandler(async (req, res) => {
  const area = await Area.findById(req.params.id);
  if (!area) return errorResponse(res, 'Area not found', 404);

  const { name, description, isActive, order } = req.body;

  // Check duplicate if name changed
  if (name && name.trim() !== area.name) {
    const dup = await Area.findOne({
      city: area.city,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      _id: { $ne: area._id },
    });
    if (dup) return errorResponse(res, `Area "${name}" already exists in this city`, 409);
  }

  if (name) area.name = name.trim();
  if (description !== undefined) area.description = description;
  if (isActive !== undefined) area.isActive = isActive;
  if (order !== undefined) area.order = order;

  await area.save();
  return successResponse(res, 'Area updated successfully', { area });
});

// ─── PUT /api/v1/buffet/admin/areas/:id/toggle ────────────────────────────────
const toggleAreaStatus = asyncHandler(async (req, res) => {
  const area = await Area.findById(req.params.id);
  if (!area) return errorResponse(res, 'Area not found', 404);

  area.isActive = !area.isActive;
  await area.save();

  return successResponse(res, `Area ${area.isActive ? 'activated' : 'deactivated'}`, { area });
});

// ─── DELETE /api/v1/buffet/admin/areas/:id ────────────────────────────────────
const deleteArea = asyncHandler(async (req, res) => {
  const area = await Area.findById(req.params.id);
  if (!area) return errorResponse(res, 'Area not found', 404);

  // Check if area is used by any hotel
  const Hotel = require('../../models/Hotel.model');
  const hotelCount = await Hotel.countDocuments({ areaId: area._id });
  if (hotelCount > 0) {
    return errorResponse(res, `Cannot delete: ${hotelCount} hotel(s) are linked to this area`, 409);
  }

  await area.deleteOne();
  return successResponse(res, 'Area deleted successfully');
});

module.exports = {
  getAllAreas,
  getAreasByCity,
  createArea,
  updateArea,
  toggleAreaStatus,
  deleteArea,
};

const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Cuisine = require('../../models/Cuisine.model');

/**
 * Admin Cuisine Controller — CRUD for cuisine types.
 */

// ─── GET /api/v1/buffet/cuisines (Public) ─────────────────────────────────────
const getAllCuisines = asyncHandler(async (req, res) => {
  const { includeInactive } = req.query;
  const query = {};
  if (!includeInactive || includeInactive !== 'true') query.isActive = true;

  const cuisines = await Cuisine.find(query)
    .sort({ order: 1, name: 1 })
    .lean();

  return successResponse(res, 'Cuisines retrieved', { cuisines });
});

// ─── POST /api/v1/buffet/admin/cuisines ───────────────────────────────────────
const createCuisine = asyncHandler(async (req, res) => {
  const { name, description, icon, isActive, order } = req.body;

  const existing = await Cuisine.findOne({
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
  });
  if (existing) return errorResponse(res, `Cuisine "${name}" already exists`, 409);

  const cuisine = await Cuisine.create({
    name: name.trim(),
    description,
    icon,
    isActive: isActive !== false,
    order: order ?? 99,
  });

  return successResponse(res, 'Cuisine created successfully', { cuisine }, 201);
});

// ─── PUT /api/v1/buffet/admin/cuisines/:id ────────────────────────────────────
const updateCuisine = asyncHandler(async (req, res) => {
  const cuisine = await Cuisine.findById(req.params.id);
  if (!cuisine) return errorResponse(res, 'Cuisine not found', 404);

  const { name, description, icon, isActive, order } = req.body;

  if (name && name.trim() !== cuisine.name) {
    const dup = await Cuisine.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      _id: { $ne: cuisine._id },
    });
    if (dup) return errorResponse(res, `Cuisine "${name}" already exists`, 409);
    cuisine.name = name.trim();
  }

  if (description !== undefined) cuisine.description = description;
  if (icon !== undefined) cuisine.icon = icon;
  if (isActive !== undefined) cuisine.isActive = isActive;
  if (order !== undefined) cuisine.order = order;

  await cuisine.save();
  return successResponse(res, 'Cuisine updated successfully', { cuisine });
});

// ─── DELETE /api/v1/buffet/admin/cuisines/:id ─────────────────────────────────
const deleteCuisine = asyncHandler(async (req, res) => {
  const cuisine = await Cuisine.findById(req.params.id);
  if (!cuisine) return errorResponse(res, 'Cuisine not found', 404);

  await cuisine.deleteOne();
  return successResponse(res, 'Cuisine deleted successfully');
});

module.exports = {
  getAllCuisines,
  createCuisine,
  updateCuisine,
  deleteCuisine,
};

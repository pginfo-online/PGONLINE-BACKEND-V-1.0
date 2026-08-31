const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const HotDealCategory = require('../models/HotDealCategory.model');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─── Admin: Create Category ───────────────────────────────────────────────────
const createCategory = asyncHandler(async (req, res) => {
  const data = { ...req.body };

  // Handle cover image upload
  if (req.file) {
    const result = await uploadToCloudinary(req.file.buffer, 'pginfo/hot-deal-categories', 'image');
    data.coverImage = { url: result.secure_url, publicId: result.public_id };
  }

  const category = await HotDealCategory.create(data);
  return successResponse(res, 'Category created', { category }, 201);
});

// ─── Admin: Update Category ───────────────────────────────────────────────────
const updateCategory = asyncHandler(async (req, res) => {
  const category = await HotDealCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  const data = { ...req.body };

  if (req.file) {
    // Delete old cover image from Cloudinary
    if (category.coverImage?.publicId) {
      await deleteFromCloudinary(category.coverImage.publicId, 'image');
    }
    const result = await uploadToCloudinary(req.file.buffer, 'pginfo/hot-deal-categories', 'image');
    data.coverImage = { url: result.secure_url, publicId: result.public_id };
  }

  Object.assign(category, data);
  await category.save();
  return successResponse(res, 'Category updated', { category });
});

// ─── Admin: Delete Category ───────────────────────────────────────────────────
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await HotDealCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  if (category.coverImage?.publicId) {
    await deleteFromCloudinary(category.coverImage.publicId, 'image').catch(() => {});
  }

  await category.deleteOne();
  return successResponse(res, 'Category deleted');
});

// ─── Admin: Toggle Active Status ─────────────────────────────────────────────
const toggleStatus = asyncHandler(async (req, res) => {
  const category = await HotDealCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  category.isActive = !category.isActive;
  await category.save();
  return successResponse(res, `Category ${category.isActive ? 'activated' : 'deactivated'}`, { category });
});

// ─── Admin: Toggle Featured ───────────────────────────────────────────────────
const toggleFeatured = asyncHandler(async (req, res) => {
  const category = await HotDealCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  category.isFeatured = !category.isFeatured;
  await category.save();
  return successResponse(res, `Category ${category.isFeatured ? 'featured' : 'unfeatured'}`, { category });
});

// ─── Admin: Reorder Category ──────────────────────────────────────────────────
const reorderCategory = asyncHandler(async (req, res) => {
  const { order } = req.body;
  if (typeof order !== 'number') return errorResponse(res, 'Order must be a number', 400);

  const category = await HotDealCategory.findByIdAndUpdate(
    req.params.id,
    { order },
    { new: true }
  );
  if (!category) return errorResponse(res, 'Category not found', 404);
  return successResponse(res, 'Order updated', { category });
});

// ─── Public: List Active Categories ──────────────────────────────────────────
const getPublicCategories = asyncHandler(async (req, res) => {
  const categories = await HotDealCategory.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .select('name displayName icon color coverImage slug order');
  return successResponse(res, 'Categories fetched', { categories });
});

// ─── Admin: List All Categories ───────────────────────────────────────────────
const getAdminCategories = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

  const [categories, total] = await Promise.all([
    HotDealCategory.find(filter).sort({ order: 1, name: 1 }).skip(skip).limit(limit),
    HotDealCategory.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Categories fetched', categories, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

module.exports = {
  createCategory,
  updateCategory,
  deleteCategory,
  toggleStatus,
  toggleFeatured,
  reorderCategory,
  getPublicCategories,
  getAdminCategories,
};

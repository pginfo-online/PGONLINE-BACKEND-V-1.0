const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const MeetupCategory = require('../models/MeetupCategory.model');
const uploadService = require('../services/upload.service');

// Cloudinary folder for all meetup category images
const CATEGORY_IMAGE_FOLDER = 'pginfo/meetup-categories';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the full category tree: each top-level category gets a `subcategories`
 * array of its children. Used for the public API response.
 */
const buildCategoryTree = async (activeOnly = true) => {
  const query = activeOnly ? { isActive: true } : {};
  const all = await MeetupCategory.find(query)
    .sort({ order: 1, name: 1 })
    .lean();

  const parents = all.filter((c) => !c.parent);
  const childrenMap = {};
  all.filter((c) => c.parent).forEach((c) => {
    const key = c.parent.toString();
    if (!childrenMap[key]) childrenMap[key] = [];
    childrenMap[key].push(c);
  });

  return parents.map((p) => ({
    ...p,
    subcategories: childrenMap[p._id.toString()] || [],
  }));
};

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/meetup-categories
 * Returns active category tree (parent + subcategories) for the mobile/web selector.
 */
const getCategories = asyncHandler(async (req, res) => {
  const { flat, parentId } = req.query;

  if (parentId) {
    // Subcategories for a specific parent (used by step 1 of wizard)
    const subcategories = await MeetupCategory.find({
      parent: parentId,
      isActive: true,
    })
      .sort({ order: 1, name: 1 })
      .lean();
    return successResponse(res, 'Subcategories retrieved', { subcategories });
  }

  if (flat === 'true') {
    // Flat list — all active categories without nesting (useful for filter pills)
    const categories = await MeetupCategory.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .lean();
    return successResponse(res, 'Categories retrieved', { categories });
  }

  // Default: full tree
  const tree = await buildCategoryTree(true);
  return successResponse(res, 'Category tree retrieved', { categories: tree });
});

/**
 * GET /api/v1/meetup-categories/:id
 * Single category with its subcategories.
 */
const getCategoryById = asyncHandler(async (req, res) => {
  const category = await MeetupCategory.findById(req.params.id).lean();
  if (!category) return errorResponse(res, 'Category not found', 404);

  const subcategories = await MeetupCategory.find({
    parent: category._id,
    isActive: true,
  })
    .sort({ order: 1, name: 1 })
    .lean();

  return successResponse(res, 'Category retrieved', { category: { ...category, subcategories } });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/meetup-categories
 * Full list (active + inactive) for admin management table.
 */
const adminGetCategories = asyncHandler(async (req, res) => {
  const { parentId, page = 1, limit = 100 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const query = {};
  if (parentId !== undefined) query.parent = parentId || null;

  const [categories, total] = await Promise.all([
    MeetupCategory.find(query)
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    MeetupCategory.countDocuments(query),
  ]);

  return paginatedResponse(res, 'Categories retrieved', categories, {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / Number(limit)),
  });
});

/**
 * POST /api/v1/admin/meetup-categories
 * Create a new category or subcategory.
 * Accepts multipart/form-data — coverImage file is optional.
 *
 * Body: { name, description?, icon?, color?, parent?, order?, isFeatured?, seoName?, seoDescription? }
 * File: req.file = coverImage (single file via multer)
 */
const createCategory = asyncHandler(async (req, res) => {
  const {
    name, description, icon, color, parent,
    order, isFeatured, seoName, seoDescription, displayName,
  } = req.body;

  if (!name || !name.trim()) {
    return errorResponse(res, 'Category name is required', 400);
  }

  // Validate parent exists if provided
  if (parent) {
    const parentDoc = await MeetupCategory.findById(parent).lean();
    if (!parentDoc) return errorResponse(res, 'Parent category not found', 404);
    if (parentDoc.parent) {
      return errorResponse(res, 'Cannot nest subcategories more than one level deep', 400);
    }
  }

  const category = new MeetupCategory({
    name: name.trim(),
    displayName: displayName?.trim() || name.trim(),
    description: description?.trim(),
    icon: icon || '🎯',
    color: color || '#4f46e5',
    parent: parent || null,
    order: order != null ? Number(order) : 99,
    isFeatured: isFeatured === 'true' || isFeatured === true,
    seoName: seoName?.trim(),
    seoDescription: seoDescription?.trim(),
  });

  // ── Upload cover image to Cloudinary ────────────────────────────────────────
  if (req.file) {
    try {
      const [uploaded] = await uploadService.uploadImages([req.file], CATEGORY_IMAGE_FOLDER);
      category.coverImage = { url: uploaded.url, publicId: uploaded.publicId };
    } catch (uploadErr) {
      return errorResponse(res, `Image upload failed: ${uploadErr.message}`, 500);
    }
  }

  await category.save();
  return successResponse(res, 'Category created successfully', { category }, 201);
});

/**
 * PUT /api/v1/admin/meetup-categories/:id
 * Update a category. Accepts multipart/form-data.
 * Passing a new coverImage file replaces the old one (old publicId deleted from Cloudinary).
 */
const updateCategory = asyncHandler(async (req, res) => {
  const category = await MeetupCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  const {
    name, description, icon, color, parent,
    order, isFeatured, isActive, seoName, seoDescription, displayName,
  } = req.body;

  // Validate parent change
  if (parent !== undefined && parent !== null) {
    if (parent.toString() === req.params.id) {
      return errorResponse(res, 'A category cannot be its own parent', 400);
    }
    const parentDoc = await MeetupCategory.findById(parent).lean();
    if (!parentDoc) return errorResponse(res, 'Parent category not found', 404);
    if (parentDoc.parent) {
      return errorResponse(res, 'Cannot nest subcategories more than one level deep', 400);
    }
  }

  // Apply scalar updates
  if (name !== undefined)        category.name = name.trim();
  if (displayName !== undefined) category.displayName = displayName.trim();
  if (description !== undefined) category.description = description.trim();
  if (icon !== undefined)        category.icon = icon;
  if (color !== undefined)       category.color = color;
  if (parent !== undefined)      category.parent = parent || null;
  if (order !== undefined)       category.order = Number(order);
  if (isFeatured !== undefined)  category.isFeatured = isFeatured === 'true' || isFeatured === true;
  if (isActive !== undefined)    category.isActive = isActive === 'true' || isActive === true;
  if (seoName !== undefined)     category.seoName = seoName.trim();
  if (seoDescription !== undefined) category.seoDescription = seoDescription.trim();

  // ── Replace cover image on Cloudinary ────────────────────────────────────────
  if (req.file) {
    // Delete old image from Cloudinary first (avoid orphaned assets)
    if (category.coverImage?.publicId) {
      try {
        await uploadService.deleteAssets([category.coverImage.publicId], 'image');
      } catch (_) {
        // Non-fatal — log but continue
        console.warn(`[MeetupCategory] Failed to delete old cover image: ${category.coverImage.publicId}`);
      }
    }
    const [uploaded] = await uploadService.uploadImages([req.file], CATEGORY_IMAGE_FOLDER);
    category.coverImage = { url: uploaded.url, publicId: uploaded.publicId };
  }

  await category.save();
  return successResponse(res, 'Category updated successfully', { category });
});

/**
 * PUT /api/v1/admin/meetup-categories/:id/toggle-status
 * Toggle isActive without touching other fields.
 */
const toggleCategoryStatus = asyncHandler(async (req, res) => {
  const category = await MeetupCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  category.isActive = !category.isActive;
  await category.save();

  return successResponse(
    res,
    category.isActive ? 'Category activated' : 'Category deactivated',
    { category }
  );
});

/**
 * PUT /api/v1/admin/meetup-categories/reorder
 * Bulk reorder. Body: { items: [{ id, order }] }
 */
const reorderCategories = asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse(res, 'items array is required', 400);
  }

  const ops = items.map(({ id, order }) =>
    MeetupCategory.findByIdAndUpdate(id, { order: Number(order) })
  );
  await Promise.all(ops);

  return successResponse(res, 'Categories reordered successfully');
});

/**
 * PUT /api/v1/admin/meetup-categories/:id/feature
 * Toggle isFeatured.
 */
const featureCategory = asyncHandler(async (req, res) => {
  const category = await MeetupCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  category.isFeatured = req.body.isFeatured != null
    ? (req.body.isFeatured === true || req.body.isFeatured === 'true')
    : !category.isFeatured;

  await category.save();
  return successResponse(res, category.isFeatured ? 'Category featured' : 'Category unfeatured', { category });
});

/**
 * DELETE /api/v1/admin/meetup-categories/:id
 * Delete category and its Cloudinary image.
 * Refuses deletion if subcategories or meetups reference this category.
 */
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await MeetupCategory.findById(req.params.id);
  if (!category) return errorResponse(res, 'Category not found', 404);

  // Guard: don't delete if subcategories exist
  const subCount = await MeetupCategory.countDocuments({ parent: category._id });
  if (subCount > 0) {
    return errorResponse(res, `Cannot delete — this category has ${subCount} subcategory(s). Delete or re-parent them first.`, 400);
  }

  // Guard: don't delete if meetups are linked
  const Meetup = require('../models/Meetup.model');
  const meetupCount = await Meetup.countDocuments({ category: category._id });
  if (meetupCount > 0) {
    return errorResponse(res, `Cannot delete — ${meetupCount} meetup(s) use this category. Re-categorize them first.`, 400);
  }

  // Delete Cloudinary cover image
  if (category.coverImage?.publicId) {
    try {
      await uploadService.deleteAssets([category.coverImage.publicId], 'image');
    } catch (_) {
      console.warn(`[MeetupCategory] Failed to delete Cloudinary image on category delete: ${category.coverImage.publicId}`);
    }
  }

  await MeetupCategory.findByIdAndDelete(req.params.id);
  return successResponse(res, 'Category deleted successfully');
});

module.exports = {
  getCategories,
  getCategoryById,
  adminGetCategories,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  reorderCategories,
  featureCategory,
  deleteCategory,
};

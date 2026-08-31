const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  createCategorySchema,
  updateCategorySchema,
} = require('../../validators/hotDeal.validator');

const {
  createCategory,
  updateCategory,
  deleteCategory,
  toggleStatus,
  toggleFeatured,
  reorderCategory,
  getPublicCategories,
  getAdminCategories,
} = require('../../controllers/hotDealCategory.controller');

// ─── Public Routes ────────────────────────────────────────────────────────────
// GET /api/v1/hot-deal-categories — active categories for mobile discovery
router.get('/', getPublicCategories);

// ─── Admin Routes ─────────────────────────────────────────────────────────────
// GET /api/v1/hot-deal-categories/admin — all categories (admin view)
router.get('/admin', protect, authorize('admin'), getAdminCategories);

// POST /api/v1/hot-deal-categories — create new category
router.post(
  '/',
  protect,
  authorize('admin'),
  upload.single('coverImage'),
  validate(createCategorySchema),
  createCategory
);

// PUT /api/v1/hot-deal-categories/:id — update category
router.put(
  '/:id',
  protect,
  authorize('admin'),
  upload.single('coverImage'),
  validate(updateCategorySchema),
  updateCategory
);

// DELETE /api/v1/hot-deal-categories/:id — delete category
router.delete('/:id', protect, authorize('admin'), deleteCategory);

// PATCH /api/v1/hot-deal-categories/:id/toggle-status
router.patch('/:id/toggle-status', protect, authorize('admin'), toggleStatus);

// PATCH /api/v1/hot-deal-categories/:id/toggle-featured
router.patch('/:id/toggle-featured', protect, authorize('admin'), toggleFeatured);

// PATCH /api/v1/hot-deal-categories/:id/order
router.patch('/:id/order', protect, authorize('admin'), reorderCategory);

module.exports = router;

const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategoryById,
  adminGetCategories,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  reorderCategories,
  featureCategory,
  deleteCategory,
} = require('../../controllers/meetupCategory.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

// ─── Public ───────────────────────────────────────────────────────────────────
router.get('/', getCategories);
router.get('/:id', getCategoryById);

// ─── Admin Only ───────────────────────────────────────────────────────────────
router.get('/admin/all', protect, authorize('admin'), adminGetCategories);
router.post('/admin', protect, authorize('admin'), upload.single('coverImage'), createCategory);
router.put('/admin/reorder', protect, authorize('admin'), reorderCategories);
router.put('/admin/:id', protect, authorize('admin'), upload.single('coverImage'), updateCategory);
router.put('/admin/:id/toggle-status', protect, authorize('admin'), toggleCategoryStatus);
router.put('/admin/:id/feature', protect, authorize('admin'), featureCategory);
router.delete('/admin/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;

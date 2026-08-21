const express = require('express');
const router = express.Router();
const {
  getCities,
  getAllCitiesAdmin,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus,
} = require('../../controllers/city.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

// ─── Public ───────────────────────────────────────────────────────────────────
// GET /api/v1/cities — mobile city selector, returns active cities only
router.get('/', getCities);

// ─── Admin ────────────────────────────────────────────────────────────────────
// GET /api/v1/cities/admin — all cities including inactive (admin panel)
router.get('/admin', protect, authorize('admin'), getAllCitiesAdmin);

// POST /api/v1/cities — create with optional image upload
router.post(
  '/',
  protect,
  authorize('admin'),
  upload.single('image'),
  createCity
);

// PUT /api/v1/cities/:id — update city, optional image replacement
router.put(
  '/:id',
  protect,
  authorize('admin'),
  upload.single('image'),
  updateCity
);

// PUT /api/v1/cities/:id/toggle-status — quick toggle active/inactive
router.put(
  '/:id/toggle-status',
  protect,
  authorize('admin'),
  toggleCityStatus
);

// DELETE /api/v1/cities/:id — delete + Cloudinary cleanup
router.delete('/:id', protect, authorize('admin'), deleteCity);

module.exports = router;

const express = require('express');
const router = express.Router();

const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  createDealSchema,
  updateDealSchema,
  changeDealStatusSchema,
} = require('../../validators/hotDeal.validator');

const {
  createDeal,
  updateDeal,
  deleteDeal,
  getDeal,
  adminListDeals,
  changeDealStatus,
  toggleFeatured,
  uploadDealImages,
  deleteDealImage,
  setMainImage,
  discoverDeals,
  getDealDetail,
  claimDeal,
} = require('../../controllers/hotDeal.controller');

// ─── Public / User Routes ─────────────────────────────────────────────────────

// GET /api/v1/hot-deals/discover — live deals for mobile discovery
router.get('/discover', optionalAuth, discoverDeals);

// GET /api/v1/hot-deals/discover/:id — deal detail page (public)
router.get('/discover/:id', optionalAuth, getDealDetail);

// POST /api/v1/hot-deals/discover/:id/claim — claim a deal (auth required)
router.post('/discover/:id/claim', protect, claimDeal);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

// GET /api/v1/hot-deals — list all deals (admin management table)
router.get('/', protect, authorize('admin'), adminListDeals);

// GET /api/v1/hot-deals/:id — get single deal (admin view with all fields)
router.get('/:id', protect, authorize('admin'), getDeal);

// POST /api/v1/hot-deals — create deal (with optional image upload)
router.post(
  '/',
  protect,
  authorize('admin'),
  upload.array('images', 10),
  validate(createDealSchema),
  createDeal
);

// PUT /api/v1/hot-deals/:id — update deal (with optional new images)
router.put(
  '/:id',
  protect,
  authorize('admin'),
  upload.array('images', 10),
  validate(updateDealSchema),
  updateDeal
);

// DELETE /api/v1/hot-deals/:id — delete deal + Cloudinary cleanup
router.delete('/:id', protect, authorize('admin'), deleteDeal);

// PATCH /api/v1/hot-deals/:id/status — change deal status
router.patch(
  '/:id/status',
  protect,
  authorize('admin'),
  validate(changeDealStatusSchema),
  changeDealStatus
);

// PATCH /api/v1/hot-deals/:id/featured — toggle featured flag
router.patch('/:id/featured', protect, authorize('admin'), toggleFeatured);

// POST /api/v1/hot-deals/:id/images — upload additional deal images
router.post(
  '/:id/images',
  protect,
  authorize('admin'),
  upload.array('images', 10),
  uploadDealImages
);

// DELETE /api/v1/hot-deals/:id/images/:publicId — delete a specific image
router.delete('/:id/images/:publicId', protect, authorize('admin'), deleteDealImage);

// PATCH /api/v1/hot-deals/:id/images/:publicId/main — set as main image
router.patch('/:id/images/:publicId/main', protect, authorize('admin'), setMainImage);

module.exports = router;

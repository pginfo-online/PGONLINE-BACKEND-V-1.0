const express = require('express');
const router = express.Router();
const {
  getProperties,
  getPropertySuggestions,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  getMyProperties,
  getAdminAnalytics,
  getAdminProperties,
  approveProperty,
  rejectProperty,
  requestCorrection,
  toggleVerify,
  suspendProperty,
} = require('../../controllers/property.controller');
const propertyUpdateRequestController = require('../../controllers/propertyUpdateRequest.controller');
const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  createPropertySchema,
  updatePropertySchema,
  propertyQuerySchema,
} = require('../../validators/property.validator');

// ─── Public routes ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, validate(propertyQuerySchema, 'query'), getProperties);
router.get('/suggestions', getPropertySuggestions);

// ─── Owner routes (MUST precede /:id) ─────────────────────────────────────────
router.get('/my', protect, authorize('owner', 'admin'), getMyProperties);
router.get('/my/update-requests', protect, authorize('owner', 'admin'), propertyUpdateRequestController.getAllUpdateRequests);
router.delete('/my/update-requests/:id', protect, authorize('owner', 'admin'), propertyUpdateRequestController.cancelUpdateRequest);

// ─── Admin Moderation routes ──────────────────────────────────────────────────
router.get('/admin/analytics', protect, authorize('admin'), getAdminAnalytics);
router.get('/admin/all', protect, authorize('admin'), getAdminProperties);
router.put('/admin/:id/approve', protect, authorize('admin'), approveProperty);
router.put('/admin/:id/reject', protect, authorize('admin'), rejectProperty);
router.put('/admin/:id/request-correction', protect, authorize('admin'), requestCorrection);
router.put('/admin/:id/verify', protect, authorize('admin'), toggleVerify);
router.put('/admin/:id/suspend', protect, authorize('admin'), suspendProperty);

// Admin staged update requests routes
router.get('/admin/updates', protect, authorize('admin'), propertyUpdateRequestController.getAllUpdateRequests);
router.get('/admin/updates/:id', protect, authorize('admin'), propertyUpdateRequestController.getUpdateRequestById);
router.put('/admin/updates/:id/approve', protect, authorize('admin'), propertyUpdateRequestController.approveUpdateRequest);
router.put('/admin/updates/:id/reject', protect, authorize('admin'), propertyUpdateRequestController.rejectUpdateRequest);

// ─── Generic Property routes ──────────────────────────────────────────────────
router.get('/:id', optionalAuth, getPropertyById);
router.post('/', protect, authorize('owner', 'admin', 'tenant'), validate(createPropertySchema), createProperty);
router.put('/:id', protect, authorize('owner', 'admin'), validate(updatePropertySchema), updateProperty);
router.delete('/:id', protect, authorize('owner', 'admin'), deleteProperty);

module.exports = router;

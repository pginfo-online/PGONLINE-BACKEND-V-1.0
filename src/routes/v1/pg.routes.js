const express = require('express');
const router = express.Router();
const {
  getPGs, getPGById, createPG, updatePG, deletePG,
  getMyPGs, getMyPGsPaginated, aiSearch, getSuggestions,
  getMyUpdateRequests, cancelUpdateRequest,
} = require('../../controllers/pg.controller');
const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const { createPGSchema, updatePGSchema, pgSearchSchema } = require('../../validators/pg.validator');

// ─── Public routes ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, validate(pgSearchSchema, 'query'), getPGs);
router.get('/suggestions', getSuggestions);
router.get('/ai-search', protect, authorize('tenant'), aiSearch);

// ─── Owner/Admin-specific routes ───────────────────────────────────────────────
// CRITICAL: These MUST be declared before /:id to prevent Express
// from treating "my" as a MongoDB ObjectId (which causes a CastError).
router.get('/my', protect, authorize('owner', 'admin'), getMyPGs);
router.get('/my/paginated', protect, authorize('owner', 'admin'), getMyPGsPaginated);
router.get('/my/update-requests', protect, authorize('owner', 'admin'), getMyUpdateRequests);
router.delete('/my/update-requests/:id', protect, authorize('owner', 'admin'), cancelUpdateRequest);

// ─── Generic PG routes (must come AFTER specific named paths) ──────────────────
router.get('/:id', optionalAuth, getPGById);
router.post('/', protect, authorize('owner', 'admin', 'tenant'), validate(createPGSchema), createPG);
router.put('/:id', protect, authorize('owner', 'admin'), validate(updatePGSchema), updatePG);
router.delete('/:id', protect, authorize('owner', 'admin'), deletePG);

module.exports = router;

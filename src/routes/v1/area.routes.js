const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/auth.middleware');
const { searchAreas, findOrCreateArea } = require('../../controllers/area.controller');

/**
 * Area routes — PG owner / public flow.
 * Admin CRUD remains on /buffet/admin/areas (unchanged).
 *
 * GET  /api/v1/areas?cityId=<id>&q=<text>   — public area search
 * POST /api/v1/areas/find-or-create          — idempotent create (auth required)
 */

// ─── Public ───────────────────────────────────────────────────────────────────
router.get('/', searchAreas);

// ─── Authenticated (owner / admin) ────────────────────────────────────────────
router.post('/find-or-create', protect, findOrCreateArea);

module.exports = router;

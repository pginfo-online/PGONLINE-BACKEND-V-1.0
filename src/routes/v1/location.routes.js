const express = require('express');
const router = express.Router();
const { resolveLocation } = require('../../controllers/location.controller');

/**
 * Location Routes — city + area resolution from Google Places data.
 *
 * POST /api/v1/location/resolve
 *   Resolves a Google Place selection to our internal City + Area records.
 *   Used by AddPG, EditPG, Step2Location (PropertyFormEngine) and mobile.
 *   No auth required — this is called during the property form flow.
 */
router.post('/resolve', resolveLocation);

module.exports = router;

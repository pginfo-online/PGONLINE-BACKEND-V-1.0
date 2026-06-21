const express = require('express');
const router = express.Router();
const { addLead, getMyLeads, getPGLeads } = require('../../controllers/lead.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');

router.post('/', protect, authorize('tenant'), addLead);
router.get('/my', protect, authorize('tenant'), getMyLeads);
router.get('/pg/:pgId', protect, authorize('owner', 'admin'), getPGLeads);

module.exports = router;

const express = require('express');
const router = express.Router();
const { createVisit, getMyVisits, getPGVisits, updateVisitStatus } = require('../../controllers/visit.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const { createVisitSchema, updateVisitStatusSchema } = require('../../validators/visit.validator');

router.post('/', protect, authorize('tenant'), validate(createVisitSchema), createVisit);
router.get('/my', protect, authorize('tenant'), getMyVisits);
router.get('/pg/:pgId', protect, authorize('owner'), getPGVisits);
router.put('/:id/status', protect, authorize('owner'), validate(updateVisitStatusSchema), updateVisitStatus);

module.exports = router;

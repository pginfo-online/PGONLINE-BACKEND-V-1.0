const express = require('express');
const router = express.Router();
const { getPGs, getPGById, createPG, updatePG, deletePG, getMyPGs, aiSearch, getSuggestions } = require('../../controllers/pg.controller');
const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const { createPGSchema, updatePGSchema, pgSearchSchema } = require('../../validators/pg.validator');

router.get('/', validate(pgSearchSchema, 'query'), getPGs);
router.get('/suggestions', getSuggestions);
router.get('/ai-search', protect, authorize('tenant'), aiSearch);
router.get('/my', protect, authorize('owner'), getMyPGs);
router.get('/:id', getPGById);
router.post('/', protect, authorize('owner'), validate(createPGSchema), createPG);
router.put('/:id', protect, authorize('owner'), validate(updatePGSchema), updatePG);
router.delete('/:id', protect, authorize('owner', 'admin'), deletePG);

module.exports = router;

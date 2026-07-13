const express = require('express');
const router = express.Router();
const {
  checkAppVersion,
  getLatestVersionRaw,
  createVersion,
  updateVersion,
  deleteVersion,
  getAllVersionsAdmin,
  getVersionAudits,
} = require('../../controllers/appVersion.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  checkVersionSchema,
  createVersionSchema,
  updateVersionSchema,
} = require('../../validators/appVersion.validator');

// Public endpoints
router.get('/check', validate(checkVersionSchema, 'query'), checkAppVersion);
router.get('/latest', getLatestVersionRaw);

// Protected Admin endpoints
router.use(protect, authorize('admin'));
router.post('/', validate(createVersionSchema), createVersion);
router.put('/:id', validate(updateVersionSchema), updateVersion);
router.delete('/:id', deleteVersion);
router.get('/admin/all', getAllVersionsAdmin);
router.get('/admin/audits', getVersionAudits);

module.exports = router;

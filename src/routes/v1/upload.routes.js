const express = require('express');
const router = express.Router();
const { uploadImages, uploadVideo, deleteImage, deleteVideo } = require('../../controllers/upload.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

router.post('/images', protect, authorize('owner', 'admin', 'tenant'), upload.array('images', 20), uploadImages);
router.post('/video', protect, authorize('owner', 'admin', 'tenant'), upload.single('video'), uploadVideo);
router.delete('/image/:pgId', protect, authorize('owner', 'admin'), deleteImage);
router.delete('/video/:pgId', protect, authorize('owner', 'admin'), deleteVideo);

module.exports = router;

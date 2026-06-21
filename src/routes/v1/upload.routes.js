const express = require('express');
const router = express.Router();
const { uploadImages, uploadVideo, deleteImage } = require('../../controllers/upload.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

router.post('/images', protect, authorize('owner'), upload.array('images', 15), uploadImages);
router.post('/video', protect, authorize('owner'), upload.single('video'), uploadVideo);
router.delete('/image/:pgId', protect, authorize('owner'), deleteImage);

module.exports = router;

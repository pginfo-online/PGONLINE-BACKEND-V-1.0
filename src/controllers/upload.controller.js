const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const uploadService = require('../services/upload.service');
const PG = require('../models/PG.model');

/**
 * @route POST /api/v1/upload/images
 * Upload multiple images to Cloudinary and optionally attach to a PG
 */
const uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const images = await uploadService.uploadImages(req.files, 'pginfo/pg-photos');

  // If pgId provided and user is owner, attach to PG
  const { pgId, setMain } = req.body;
  if (pgId) {
    const pg = await PG.findOne({ _id: pgId, owner: req.user._id });
    if (pg) {
      if (setMain && images.length > 0) {
        pg.photos.forEach((p) => (p.isMain = false));
        images[0].isMain = true;
      }
      pg.photos.push(...images);
      await pg.save();
    }
  }

  successResponse(res, `${images.length} image(s) uploaded successfully`, { images }, 201);
});

/**
 * @route POST /api/v1/upload/video
 * Upload a single video
 */
const uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No video file uploaded' });
  }

  const video = await uploadService.uploadVideo(req.file, 'pginfo/pg-videos');

  const { pgId } = req.body;
  if (pgId) {
    const pg = await PG.findOne({ _id: pgId, owner: req.user._id });
    if (pg) {
      pg.videos.push(video);
      await pg.save();
    }
  }

  successResponse(res, 'Video uploaded successfully', { video }, 201);
});

/**
 * @route DELETE /api/v1/upload/image/:pgId
 * Remove a photo from a PG listing
 */
const deleteImage = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const { publicId } = req.body;

  const pg = await PG.findOne({ _id: pgId, owner: req.user._id });
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });

  await uploadService.deleteAssets([publicId], 'image');
  pg.photos = pg.photos.filter((p) => p.publicId !== publicId);
  await pg.save();

  successResponse(res, 'Image deleted', { photos: pg.photos });
});

module.exports = { uploadImages, uploadVideo, deleteImage };

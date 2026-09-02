const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const uploadService = require('../services/upload.service');
const PG = require('../models/PG.model');

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_VIDEOS_PER_PG = 3;

/**
 * @route POST /api/v1/upload/images
 * Upload multiple images to Cloudinary and attach to a PG
 */
const uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const images = await uploadService.uploadImages(req.files, 'pginfo/pg-photos');

  const { pgId, setMain } = req.body;
  if (pgId) {
    const pgQuery = req.user.role === 'admin' ? { _id: pgId } : { _id: pgId, owner: req.user._id };
    const pg = await PG.findOne(pgQuery);
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
 * Upload a single video to Cloudinary and attach to a PG.
 * Validates MIME type, file size, and max videos per PG.
 */
const uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No video file uploaded' });
  }

  // MIME type validation
  if (!ALLOWED_VIDEO_TYPES.includes(req.file.mimetype)) {
    return res.status(415).json({
      success: false,
      message: `Invalid file type. Allowed: MP4, WebM, MOV, AVI. Got: ${req.file.mimetype}`,
    });
  }

  // File size validation
  if (req.file.size > MAX_VIDEO_SIZE_BYTES) {
    return res.status(413).json({
      success: false,
      message: `Video too large. Maximum allowed size is 100 MB. Got: ${(req.file.size / 1024 / 1024).toFixed(1)} MB`,
    });
  }

  const { pgId, title } = req.body;

  // Max videos per PG validation
  if (pgId) {
    const pgQuery = req.user.role === 'admin' ? { _id: pgId } : { _id: pgId, owner: req.user._id };
    const pg = await PG.findOne(pgQuery);
    if (!pg) {
      return res.status(404).json({ success: false, message: 'PG not found or not authorized' });
    }
    if (pg.videos && pg.videos.length >= MAX_VIDEOS_PER_PG) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_VIDEOS_PER_PG} videos allowed per PG. Please delete an existing video first.`,
      });
    }

    const videoData = await uploadService.uploadVideo(req.file, 'pginfo/pg-videos');
    const videoEntry = {
      ...videoData,
      title: title || null,
      order: pg.videos.length,
    };

    pg.videos.push(videoEntry);
    await pg.save();

    const savedVideo = pg.videos[pg.videos.length - 1];
    return successResponse(res, 'Video uploaded successfully', { video: savedVideo }, 201);
  }

  // Upload without attaching to a PG
  const videoData = await uploadService.uploadVideo(req.file, 'pginfo/pg-videos');
  successResponse(res, 'Video uploaded successfully', { video: videoData }, 201);
});

/**
 * @route DELETE /api/v1/upload/image/:pgId
 * Remove a photo from a PG listing and delete from Cloudinary
 */
const deleteImage = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({ success: false, message: 'publicId is required' });
  }

  const pgQuery = req.user.role === 'admin' ? { _id: pgId } : { _id: pgId, owner: req.user._id };
  const pg = await PG.findOne(pgQuery);
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });

  try {
    await uploadService.deleteAssets([publicId], 'image');
  } catch (cloudErr) {
    console.warn('Cloudinary delete image warning:', cloudErr.message);
  }

  // Atomically remove photo using $pull (prevents Mongoose VersionError)
  const updatedPG = await PG.findByIdAndUpdate(
    pgId,
    { $pull: { photos: { publicId } } },
    { new: true }
  );

  // If main photo was deleted and other photos exist, set first remaining as main
  if (updatedPG?.photos?.length > 0 && !updatedPG.photos.some((p) => p.isMain)) {
    await PG.updateOne(
      { _id: pgId, 'photos.0': { $exists: true } },
      { $set: { 'photos.0.isMain': true } }
    );
    updatedPG.photos[0].isMain = true;
  }

  successResponse(res, 'Image deleted', { photos: updatedPG ? updatedPG.photos : [] });
});

/**
 * @route DELETE /api/v1/upload/video/:pgId
 * Remove a video from a PG listing and delete from Cloudinary
 */
const deleteVideo = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({ success: false, message: 'publicId is required' });
  }

  const pgQuery = req.user.role === 'admin' ? { _id: pgId } : { _id: pgId, owner: req.user._id };
  const pg = await PG.findOne(pgQuery);
  if (!pg) return res.status(404).json({ success: false, message: 'PG not found' });

  try {
    await uploadService.deleteAssets([publicId], 'video');
  } catch (cloudErr) {
    console.warn('Cloudinary delete video warning:', cloudErr.message);
  }

  // Atomically pull video from PG document (prevents VersionError)
  const updatedPG = await PG.findByIdAndUpdate(
    pgId,
    { $pull: { videos: { publicId } } },
    { new: true }
  );

  // Re-assign order values if needed
  if (updatedPG?.videos?.length > 0) {
    const reordered = updatedPG.videos.map((v, i) => ({ ...v.toObject(), order: i }));
    await PG.findByIdAndUpdate(pgId, { $set: { videos: reordered } });
    updatedPG.videos = reordered;
  }

  successResponse(res, 'Video deleted', { videos: updatedPG ? updatedPG.videos : [] });
});

module.exports = { uploadImages, uploadVideo, deleteImage, deleteVideo };

const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const uploadService = require('../services/upload.service');
const PG = require('../models/PG.model');
const Property = require('../models/Property.model');

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_VIDEOS_PER_PROPERTY = 1;
const MAX_PHOTOS_PER_PROPERTY = 20;

/**
 * Helper to find entity in Property first, then PG
 */
const findPropertyOrPG = async (id, user) => {
  const query = user.role === 'admin' ? { _id: id } : { _id: id, owner: user._id };
  const property = await Property.findOne(query);
  if (property) return { doc: property, model: 'Property' };

  const pg = await PG.findOne(query);
  if (pg) return { doc: pg, model: 'PG' };

  return { doc: null, model: null };
};

/**
 * @route POST /api/v1/upload/images
 * Upload multiple images to Cloudinary and attach to a Property or PG
 */
const uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const targetId = req.body.propertyId || req.body.pgId;
  let targetDoc = null;
  let targetModel = null;

  if (targetId) {
    const found = await findPropertyOrPG(targetId, req.user);
    targetDoc = found.doc;
    targetModel = found.model;

    if (!targetDoc) {
      return res.status(404).json({ success: false, message: 'Property not found or unauthorized' });
    }

    const currentCount = targetDoc.photos ? targetDoc.photos.length : 0;
    if (currentCount + req.files.length > MAX_PHOTOS_PER_PROPERTY) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_PHOTOS_PER_PROPERTY} photos allowed. Current: ${currentCount}, trying to add: ${req.files.length}`,
      });
    }
  }

  const images = await uploadService.uploadImages(req.files, 'pginfo/property-photos');

  if (targetDoc) {
    const setMain = req.body.setMain === 'true' || req.body.setMain === true;
    const existingPhotos = targetDoc.photos || [];

    if (setMain && images.length > 0) {
      existingPhotos.forEach((p) => (p.isMain = false));
      images[0].isMain = true;
    } else if (existingPhotos.length === 0 && images.length > 0) {
      images[0].isMain = true;
    }

    images.forEach((img, idx) => {
      img.order = existingPhotos.length + idx;
    });

    existingPhotos.push(...images);
    targetDoc.photos = existingPhotos.slice(0, MAX_PHOTOS_PER_PROPERTY);
    await targetDoc.save();

    // If target was Property, keep PG in sync if exists
    if (targetModel === 'Property') {
      try {
        await PG.findByIdAndUpdate(targetId, { $set: { photos: targetDoc.photos } });
      } catch (e) {}
    } else {
      try {
        await Property.findByIdAndUpdate(targetId, { $set: { photos: targetDoc.photos } });
      } catch (e) {}
    }

    return successResponse(
      res,
      `${images.length} image(s) uploaded and saved to property`,
      { images, photos: targetDoc.photos },
      201
    );
  }

  successResponse(res, `${images.length} image(s) uploaded successfully`, { images }, 201);
});

/**
 * @route POST /api/v1/upload/video
 * Upload a single video to Cloudinary and attach to a Property or PG.
 * Validates MIME type, file size (max 50MB), and max 1 video per property.
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

  // File size validation (Max 50MB)
  if (req.file.size > MAX_VIDEO_SIZE_BYTES) {
    return res.status(413).json({
      success: false,
      message: `Video too large. Maximum allowed size is 50 MB. Got: ${(req.file.size / 1024 / 1024).toFixed(1)} MB`,
    });
  }

  const targetId = req.body.propertyId || req.body.pgId;
  const { title } = req.body;

  if (targetId) {
    const { doc: targetDoc, model } = await findPropertyOrPG(targetId, req.user);
    if (!targetDoc) {
      return res.status(404).json({ success: false, message: 'Property not found or not authorized' });
    }

    // If an existing video exists, replace it
    if (targetDoc.videos && targetDoc.videos.length >= MAX_VIDEOS_PER_PROPERTY) {
      const oldVideo = targetDoc.videos[0];
      if (oldVideo?.publicId) {
        uploadService.deleteAssets([oldVideo.publicId], 'video').catch((err) => {
          console.warn('Could not remove old video from Cloudinary:', err.message);
        });
      }
      targetDoc.videos = [];
    }

    const videoData = await uploadService.uploadVideo(req.file, 'pginfo/property-videos');
    const videoEntry = {
      ...videoData,
      title: title || 'Walkthrough Video Tour',
      order: 0,
      uploadedAt: new Date(),
    };

    targetDoc.videos = [videoEntry];
    await targetDoc.save();

    const savedVideo = targetDoc.videos[0];
    return successResponse(res, 'Walkthrough video uploaded successfully', { video: savedVideo }, 201);
  }

  // Upload without attaching to a property
  const videoData = await uploadService.uploadVideo(req.file, 'pginfo/property-videos');
  successResponse(res, 'Video uploaded successfully', { video: videoData }, 201);
});

/**
 * @route DELETE /api/v1/upload/image/:id
 * Remove a photo from a Property or PG listing and delete from Cloudinary
 */
const deleteImage = asyncHandler(async (req, res) => {
  const targetId = req.params.pgId || req.params.id;
  const { publicId, url } = req.body;

  if (!publicId && !url) {
    return res.status(400).json({ success: false, message: 'publicId or url is required' });
  }

  const { doc: targetDoc, model } = await findPropertyOrPG(targetId, req.user);
  if (!targetDoc) return res.status(404).json({ success: false, message: 'Property not found' });

  if (publicId) {
    try {
      await uploadService.deleteAssets([publicId], 'image');
    } catch (cloudErr) {
      console.warn('Cloudinary delete image warning:', cloudErr.message);
    }
  }

  const pullCondition = publicId && url
    ? { $or: [{ publicId }, { url }] }
    : publicId
    ? { publicId }
    : { url };

  const updatedDoc = await Property.findByIdAndUpdate(
    targetId,
    { $pull: { photos: pullCondition } },
    { new: true }
  );

  // Keep PG in sync if it exists
  try {
    await PG.findByIdAndUpdate(targetId, { $pull: { photos: pullCondition } });
  } catch (e) {}

  const finalDoc = updatedDoc || targetDoc;

  // If main photo was deleted and other photos exist, set first remaining as main
  if (finalDoc?.photos?.length > 0 && !finalDoc.photos.some((p) => p.isMain)) {
    await Property.updateOne(
      { _id: targetId, 'photos.0': { $exists: true } },
      { $set: { 'photos.0.isMain': true } }
    );
    try {
      await PG.updateOne(
        { _id: targetId, 'photos.0': { $exists: true } },
        { $set: { 'photos.0.isMain': true } }
      );
    } catch (e) {}
    finalDoc.photos[0].isMain = true;
  }

  successResponse(res, 'Image deleted', { photos: finalDoc ? finalDoc.photos : [] });
});

/**
 * @route DELETE /api/v1/upload/video/:id
 * Remove a video from a Property or PG listing and delete from Cloudinary
 */
const deleteVideo = asyncHandler(async (req, res) => {
  const targetId = req.params.pgId || req.params.id;
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({ success: false, message: 'publicId is required' });
  }

  const { doc: targetDoc, model } = await findPropertyOrPG(targetId, req.user);
  if (!targetDoc) return res.status(404).json({ success: false, message: 'Property not found' });

  try {
    await uploadService.deleteAssets([publicId], 'video');
  } catch (cloudErr) {
    console.warn('Cloudinary delete video warning:', cloudErr.message);
  }

  const Model = model === 'Property' ? Property : PG;
  const updatedDoc = await Model.findByIdAndUpdate(
    targetId,
    { $pull: { videos: { publicId } } },
    { new: true }
  );

  successResponse(res, 'Video deleted', { videos: updatedDoc ? updatedDoc.videos : [] });
});

module.exports = { uploadImages, uploadVideo, deleteImage, deleteVideo };

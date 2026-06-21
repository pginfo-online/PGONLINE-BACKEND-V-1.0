const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

/**
 * Upload multiple images to Cloudinary
 * @param {Express.Multer.File[]} files
 * @param {string} folder
 * @returns {Promise<Array>}
 */
const uploadImages = async (files, folder = 'pginfo/pg-photos') => {
  const uploads = files.map(async (file) => {
    const result = await uploadToCloudinary(file.buffer, folder, 'image');
    return {
      url: result.secure_url,
      publicId: result.public_id,
      isMain: false,
    };
  });

  return Promise.all(uploads);
};

/**
 * Upload a single video to Cloudinary
 */
const uploadVideo = async (file, folder = 'pginfo/pg-videos') => {
  const result = await uploadToCloudinary(file.buffer, folder, 'video');
  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/**
 * Delete multiple assets from Cloudinary by publicIds
 */
const deleteAssets = async (publicIds, resourceType = 'image') => {
  const deletes = publicIds.map((id) => deleteFromCloudinary(id, resourceType));
  return Promise.all(deletes);
};

module.exports = { uploadImages, uploadVideo, deleteAssets };

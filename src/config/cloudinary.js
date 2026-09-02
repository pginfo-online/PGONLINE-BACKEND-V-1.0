const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {string} folder - Cloudinary folder
 * @param {string} resourceType - 'image' | 'video'
 * @returns {Promise<Object>}
 */
const uploadToCloudinary = (buffer, folder = 'pginfo/general', resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: resourceType,
      timeout: 300000, // 5 minutes socket timeout
    };

    if (resourceType === 'video') {
      uploadOptions.chunk_size = 6000000; // 6MB streaming chunks for video
    } else {
      uploadOptions.quality = 'auto';
      uploadOptions.fetch_format = 'auto';
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Delete an asset from Cloudinary
 * @param {string} publicId
 * @param {string} resourceType
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };

const multer = require('multer');

// Store files in memory; upload to Cloudinary in the service layer
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedImages = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  const allowedVideos = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];

  if ([...allowedImages, ...allowedVideos].includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP images and MP4/MOV videos are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for videos
    files: 20,
  },
});

module.exports = upload;

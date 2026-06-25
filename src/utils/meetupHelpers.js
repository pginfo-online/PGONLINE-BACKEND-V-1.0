const MIN_MEETUP_IMAGES = 3;
const MAX_MEETUP_IMAGES = 4;

/**
 * Resolve cover image URL from images array or legacy bannerImage
 */
const getMeetupCoverImage = (meetup) => {
  const images = meetup?.images || [];
  const main = images.find((img) => img.isMain) || images[0];
  if (main?.url) return main;
  if (meetup?.bannerImage?.url) return meetup.bannerImage;
  return null;
};

/**
 * Sync legacy bannerImage from the main meetup photo
 */
const syncBannerFromImages = (meetup) => {
  const cover = getMeetupCoverImage(meetup);
  if (cover?.url) {
    meetup.bannerImage = { url: cover.url, publicId: cover.publicId || null };
  } else {
    meetup.bannerImage = { url: null, publicId: null };
  }
};

const isMeetupLive = (meetup) =>
  meetup.status === 'published' && meetup.isAdminApproved === true;

/**
 * Resolve user/owner id whether field is populated or a raw ObjectId
 */
const resolveRefId = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (ref._id) return ref._id.toString();
  if (typeof ref.toString === 'function' && ref.toString().length === 24) {
    return ref.toString();
  }
  return null;
};

module.exports = {
  MIN_MEETUP_IMAGES,
  MAX_MEETUP_IMAGES,
  getMeetupCoverImage,
  syncBannerFromImages,
  isMeetupLive,
  resolveRefId,
};

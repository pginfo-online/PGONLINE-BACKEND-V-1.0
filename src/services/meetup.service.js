const Meetup = require('../models/Meetup.model');
const uploadService = require('./upload.service');
const {
  MIN_MEETUP_IMAGES,
  MAX_MEETUP_IMAGES,
  syncBannerFromImages,
  isMeetupLive,
  resolveRefId,
} = require('../utils/meetupHelpers');

const PROTECTED_UPDATE_FIELDS = [
  '_id', 'id', 'createdBy', 'rsvpList', 'analytics', 'createdAt', 'updatedAt', '__v',
  'isAdminApproved', 'status',
];

const LIVE_PUBLIC_QUERY = { status: 'published', isAdminApproved: true };

const canManageMeetup = (meetup, userId, role) => {
  if (role === 'admin') return true;
  if (!userId) return false;
  return resolveRefId(meetup.createdBy) === userId.toString();
};

const canViewMeetup = (meetup, userId, role) => {
  if (isMeetupLive(meetup)) return true;
  if (role === 'admin') return true;
  if (!userId) return false;
  return resolveRefId(meetup.createdBy) === userId.toString();
};

/**
 * Get published & admin-approved meetups with filtering and pagination
 */
const getMeetups = async (params = {}) => {
  const { category, city, page = 1, limit = 10 } = params;
  const query = { ...LIVE_PUBLIC_QUERY };

  if (category) query.category = category;
  if (city) query['location.city'] = { $regex: new RegExp(city, 'i') };

  const parsedPage = parseInt(page, 10) || 1;
  const parsedLimit = parseInt(limit, 10) || 10;
  const skip = (parsedPage - 1) * parsedLimit;

  const [meetups, total] = await Promise.all([
    Meetup.find(query)
      .populate('createdBy', 'name email role')
      .populate('organizer.pg', 'name city area')
      .sort({ startDate: 1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Meetup.countDocuments(query),
  ]);

  return {
    meetups,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit),
    },
  };
};

/**
 * Get upcoming live meetups
 */
const getUpcomingMeetups = async (limit = 10) => {
  const parsedLimit = parseInt(limit, 10) || 10;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const meetups = await Meetup.find({
    ...LIVE_PUBLIC_QUERY,
    startDate: { $gte: today },
  })
    .populate('createdBy', 'name email role')
    .populate('organizer.pg', 'name city area')
    .sort({ startDate: 1 })
    .limit(parsedLimit)
    .lean();

  return { meetups };
};

/**
 * Get meetup by ID (with access control)
 */
const getMeetupById = async (id, viewer = null) => {
  const meetup = await Meetup.findById(id)
    .populate('createdBy', 'name email role')
    .populate('organizer.pg', 'name city area');

  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  const viewerId = viewer?._id || viewer?.id;
  const viewerRole = viewer?.role;

  if (!canViewMeetup(meetup, viewerId, viewerRole)) {
    const err = new Error(
      viewerId
        ? 'You do not have permission to view this meetup'
        : 'Meetup not found'
    );
    err.statusCode = viewerId ? 403 : 404;
    throw err;
  }

  if (isMeetupLive(meetup)) {
    meetup.analytics.views = (meetup.analytics.views || 0) + 1;
    await meetup.save();
  }

  return { meetup };
};

/**
 * Create a new meetup draft
 */
const createMeetup = async (userId, data) => {
  const meetup = new Meetup({
    ...data,
    createdBy: userId,
    status: 'draft',
    isAdminApproved: false,
  });

  await meetup.save();
  return { meetup };
};

/**
 * Update meetup (must be creator or admin)
 * Published meetups require re-approval after owner edits
 */
const updateMeetup = async (meetupId, userId, role, data) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to update this meetup');
    err.statusCode = 403;
    throw err;
  }

  const wasLive = isMeetupLive(meetup);

  Object.keys(data).forEach((key) => {
    if (PROTECTED_UPDATE_FIELDS.includes(key)) return;
    meetup[key] = data[key];
  });

  if (wasLive && role !== 'admin') {
    meetup.status = 'pending_approval';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

/**
 * Delete meetup
 */
const deleteMeetup = async (meetupId, userId, role) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to delete this meetup');
    err.statusCode = 403;
    throw err;
  }

  if (meetup.images?.length) {
    await uploadService.deleteAssets(
      meetup.images.map((img) => img.publicId),
      'image'
    );
  }

  await Meetup.findByIdAndDelete(meetupId);
  return true;
};

/**
 * Submit meetup for admin approval (owner action)
 */
const publishMeetup = async (meetupId, userId, role) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to publish this meetup');
    err.statusCode = 403;
    throw err;
  }

  if (!['draft', 'pending_approval'].includes(meetup.status)) {
    const err = new Error('Only draft meetups can be submitted for approval');
    err.statusCode = 400;
    throw err;
  }

  const imageCount = meetup.images?.length || 0;
  if (imageCount < MIN_MEETUP_IMAGES) {
    const err = new Error(`Please upload at least ${MIN_MEETUP_IMAGES} meetup photos before submitting`);
    err.statusCode = 400;
    throw err;
  }

  meetup.status = 'pending_approval';
  meetup.isAdminApproved = false;
  await meetup.save();
  return { meetup };
};

/**
 * Upload meetup images (3–4 max)
 */
const uploadMeetupImages = async (meetupId, userId, role, files, setMain = false) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to update this meetup');
    err.statusCode = 403;
    throw err;
  }

  const currentCount = meetup.images?.length || 0;
  if (currentCount + files.length > MAX_MEETUP_IMAGES) {
    const err = new Error(`Maximum ${MAX_MEETUP_IMAGES} photos allowed per meetup`);
    err.statusCode = 400;
    throw err;
  }

  const uploaded = await uploadService.uploadImages(files, 'pginfo/meetup-photos');

  if ((setMain || currentCount === 0) && uploaded.length > 0) {
    meetup.images.forEach((img) => { img.isMain = false; });
    uploaded[0].isMain = true;
  }

  meetup.images.push(...uploaded);
  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'pending_approval';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup, images: uploaded };
};

/**
 * Remove a meetup image
 */
const deleteMeetupImage = async (meetupId, userId, role, publicId) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to update this meetup');
    err.statusCode = 403;
    throw err;
  }

  const image = meetup.images.find((img) => img.publicId === publicId);
  if (!image) {
    const err = new Error('Image not found');
    err.statusCode = 404;
    throw err;
  }

  await uploadService.deleteAssets([publicId], 'image');
  meetup.images = meetup.images.filter((img) => img.publicId !== publicId);

  if (image.isMain && meetup.images.length > 0) {
    meetup.images[0].isMain = true;
  }

  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'pending_approval';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

/**
 * Set main cover image
 */
const setMainMeetupImage = async (meetupId, userId, role, publicId) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!canManageMeetup(meetup, userId, role)) {
    const err = new Error('Unauthorized to update this meetup');
    err.statusCode = 403;
    throw err;
  }

  const target = meetup.images.find((img) => img.publicId === publicId);
  if (!target) {
    const err = new Error('Image not found');
    err.statusCode = 404;
    throw err;
  }

  meetup.images.forEach((img) => { img.isMain = img.publicId === publicId; });
  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'pending_approval';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

/**
 * RSVP meetup (toggle interested/going)
 */
const rsvpMeetup = async (meetupId, userId, rsvpStatus) => {
  if (!['interested', 'going'].includes(rsvpStatus)) {
    const err = new Error('Invalid RSVP status');
    err.statusCode = 400;
    throw err;
  }

  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (!isMeetupLive(meetup)) {
    const err = new Error('Cannot RSVP to an unavailable meetup');
    err.statusCode = 400;
    throw err;
  }

  const existingRsvpIndex = meetup.rsvpList.findIndex(
    (rsvp) => rsvp.user.toString() === userId.toString()
  );

  if (existingRsvpIndex > -1) {
    const existingRsvp = meetup.rsvpList[existingRsvpIndex];
    if (existingRsvp.status === rsvpStatus) {
      meetup.rsvpList.splice(existingRsvpIndex, 1);
    } else {
      existingRsvp.status = rsvpStatus;
      existingRsvp.timestamp = new Date();
    }
  } else {
    meetup.rsvpList.push({
      user: userId,
      status: rsvpStatus,
      timestamp: new Date(),
    });
  }

  await meetup.save();
  return meetup;
};

/**
 * Get meetups created by a user
 */
const getMyMeetups = async (userId) => {
  const meetups = await Meetup.find({ createdBy: userId })
    .populate('organizer.pg', 'name city area')
    .sort({ createdAt: -1 })
    .lean();

  return { meetups };
};

/**
 * Admin: Get all meetups regardless of status
 */
const adminGetAllMeetups = async (params = {}) => {
  const { status, page = 1, limit = 20 } = params;
  const query = {};

  if (status) query.status = status;

  const parsedPage = parseInt(page, 10) || 1;
  const parsedLimit = parseInt(limit, 10) || 20;
  const skip = (parsedPage - 1) * parsedLimit;

  const [meetups, total] = await Promise.all([
    Meetup.find(query)
      .populate('createdBy', 'name email role')
      .populate('organizer.pg', 'name city area')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Meetup.countDocuments(query),
  ]);

  return {
    meetups,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit),
    },
  };
};

/**
 * Admin: Approve or reject meetup for going live
 */
const adminToggleApproval = async (meetupId, approve) => {
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  if (approve) {
    if ((meetup.images?.length || 0) < MIN_MEETUP_IMAGES) {
      const err = new Error(`Meetup needs at least ${MIN_MEETUP_IMAGES} photos before approval`);
      err.statusCode = 400;
      throw err;
    }
    meetup.isAdminApproved = true;
    meetup.status = 'published';
  } else {
    meetup.isAdminApproved = false;
    if (meetup.status === 'published') {
      meetup.status = 'pending_approval';
    }
  }

  await meetup.save();
  return { meetup };
};

module.exports = {
  getMeetups,
  getUpcomingMeetups,
  getMeetupById,
  createMeetup,
  updateMeetup,
  deleteMeetup,
  publishMeetup,
  uploadMeetupImages,
  deleteMeetupImage,
  setMainMeetupImage,
  rsvpMeetup,
  getMyMeetups,
  adminGetAllMeetups,
  adminToggleApproval,
  MIN_MEETUP_IMAGES,
  MAX_MEETUP_IMAGES,
};

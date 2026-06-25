const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/apiResponse');
const meetupService = require('../services/meetup.service');

/**
 * @route GET /api/v1/meetups
 */
const getMeetups = asyncHandler(async (req, res) => {
  const { meetups, pagination } = await meetupService.getMeetups(req.query);
  paginatedResponse(res, 'Meetups retrieved successfully', meetups, pagination);
});

/**
 * @route GET /api/v1/meetups/upcoming
 */
const getUpcomingMeetups = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const { meetups } = await meetupService.getUpcomingMeetups(limit);
  successResponse(res, 'Upcoming meetups retrieved successfully', { meetups });
});

/**
 * @route GET /api/v1/meetups/:id
 */
const getMeetupById = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.getMeetupById(req.params.id, req.user);
  successResponse(res, 'Meetup details retrieved successfully', { meetup });
});

/**
 * @route POST /api/v1/meetups
 */
const createMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.createMeetup(req.user._id, req.body);
  successResponse(res, 'Meetup created successfully as draft', { meetup }, 201);
});

/**
 * @route PUT /api/v1/meetups/:id
 */
const updateMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.updateMeetup(
    req.params.id,
    req.user._id,
    req.user.role,
    req.body
  );
  successResponse(res, 'Meetup updated successfully', { meetup });
});

/**
 * @route DELETE /api/v1/meetups/:id
 */
const deleteMeetup = asyncHandler(async (req, res) => {
  await meetupService.deleteMeetup(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'Meetup deleted successfully');
});

/**
 * @route PUT /api/v1/meetups/:id/publish
 */
const publishMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.publishMeetup(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'Meetup submitted for admin approval', { meetup });
});

/**
 * @route POST /api/v1/meetups/:id/images
 */
const uploadMeetupImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const { meetup, images } = await meetupService.uploadMeetupImages(
    req.params.id,
    req.user._id,
    req.user.role,
    req.files,
    req.body.setMain === 'true'
  );

  successResponse(res, `${images.length} image(s) uploaded successfully`, { meetup, images }, 201);
});

/**
 * @route DELETE /api/v1/meetups/:id/images
 */
const deleteMeetupImage = asyncHandler(async (req, res) => {
  const { publicId } = req.body;
  const { meetup } = await meetupService.deleteMeetupImage(
    req.params.id,
    req.user._id,
    req.user.role,
    publicId
  );
  successResponse(res, 'Image removed successfully', { meetup });
});

/**
 * @route PUT /api/v1/meetups/:id/images/main
 */
const setMainMeetupImage = asyncHandler(async (req, res) => {
  const { publicId } = req.body;
  const { meetup } = await meetupService.setMainMeetupImage(
    req.params.id,
    req.user._id,
    req.user.role,
    publicId
  );
  successResponse(res, 'Cover image updated', { meetup });
});

/**
 * @route POST /api/v1/meetups/:id/rsvp
 */
const rsvpMeetup = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const meetup = await meetupService.rsvpMeetup(req.params.id, req.user._id, status);
  successResponse(res, 'RSVP updated successfully', { rsvpList: meetup.rsvpList });
});

/**
 * @route GET /api/v1/meetups/my
 */
const getMyMeetups = asyncHandler(async (req, res) => {
  const { meetups } = await meetupService.getMyMeetups(req.user._id);
  successResponse(res, 'Your meetups retrieved successfully', { meetups });
});

/**
 * @route GET /api/v1/admin/meetups
 */
const adminGetAllMeetups = asyncHandler(async (req, res) => {
  const { meetups, pagination } = await meetupService.adminGetAllMeetups(req.query);
  paginatedResponse(res, 'All meetups retrieved for admin', meetups, pagination);
});

/**
 * @route PUT /api/v1/admin/meetups/:id/approve
 */
const adminToggleApproval = asyncHandler(async (req, res) => {
  const Meetup = require('../models/Meetup.model');
  const existing = await Meetup.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Meetup not found' });
  }

  const approve = typeof req.body.approve === 'boolean'
    ? req.body.approve
    : !existing.isAdminApproved;

  const { meetup } = await meetupService.adminToggleApproval(req.params.id, approve);
  const message = meetup.isAdminApproved
    ? 'Meetup approved and is now live'
    : 'Meetup approval revoked';
  successResponse(res, message, { meetup });
});

/**
 * @route DELETE /api/v1/admin/meetups/:id
 */
const adminDeleteMeetup = asyncHandler(async (req, res) => {
  await meetupService.deleteMeetup(req.params.id, req.user._id, 'admin');
  successResponse(res, 'Meetup deleted by admin');
});

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
  adminDeleteMeetup,
};

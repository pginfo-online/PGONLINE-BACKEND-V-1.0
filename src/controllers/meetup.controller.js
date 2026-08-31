const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse, errorResponse } = require('../utils/apiResponse');
const meetupService = require('../services/meetup.service');

// ─── Public / Tenant ──────────────────────────────────────────────────────────

/** GET /api/v1/meetups/discover */
const discoverMeetups = asyncHandler(async (req, res) => {
  const { city, lat, lng, categoryId, radius } = req.query;
  const { sections } = await meetupService.getDiscoverySections({ city, lat, lng, categoryId, radius });
  successResponse(res, 'Discovery sections retrieved', { sections });
});

/** GET /api/v1/meetups/nearby */
const getNearbyMeetups = asyncHandler(async (req, res) => {
  const { lat, lng, radius, limit } = req.query;
  const { meetups } = await meetupService.getNearbyMeetups({ lat, lng, radius, limit });
  successResponse(res, 'Nearby meetups retrieved', { meetups });
});

/** GET /api/v1/meetups */
const getMeetups = asyncHandler(async (req, res) => {
  const { meetups, pagination } = await meetupService.getMeetups(req.query);
  paginatedResponse(res, 'Meetups retrieved', meetups, pagination);
});

/** GET /api/v1/meetups/upcoming */
const getUpcomingMeetups = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const { meetups } = await meetupService.getUpcomingMeetups(limit);
  successResponse(res, 'Upcoming meetups retrieved', { meetups });
});

/** GET /api/v1/meetups/my */
const getMyMeetups = asyncHandler(async (req, res) => {
  const { meetups } = await meetupService.getMyMeetups(req.user._id);
  successResponse(res, 'Your meetups retrieved', { meetups });
});

/** GET /api/v1/meetups/:id */
const getMeetupById = asyncHandler(async (req, res) => {
  const { meetup, myParticipation } = await meetupService.getMeetupById(req.params.id, req.user);
  successResponse(res, 'Meetup retrieved', { meetup, myParticipation });
});

/** POST /api/v1/meetups */
const createMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.createMeetup(req.user._id, req.body);
  successResponse(res, 'Meetup draft created', { meetup }, 201);
});

/** PUT /api/v1/meetups/:id */
const updateMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.updateMeetup(
    req.params.id, req.user._id, req.user.role, req.body
  );
  successResponse(res, 'Meetup updated', { meetup });
});

/** DELETE /api/v1/meetups/:id */
const deleteMeetup = asyncHandler(async (req, res) => {
  await meetupService.deleteMeetup(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'Meetup deleted');
});

/** PUT /api/v1/meetups/:id/publish  (submit for approval) */
const publishMeetup = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.submitMeetup(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'Meetup submitted for approval', { meetup });
});

// ─── Image Management ─────────────────────────────────────────────────────────

/** POST /api/v1/meetups/:id/images */
const uploadMeetupImages = asyncHandler(async (req, res) => {
  if (!req.files?.length) {
    return errorResponse(res, 'No files uploaded', 400);
  }
  const { meetup, images } = await meetupService.uploadMeetupImages(
    req.params.id, req.user._id, req.user.role,
    req.files, req.body.setMain === 'true'
  );
  successResponse(res, `${images.length} image(s) uploaded`, { meetup, images }, 201);
});

/** DELETE /api/v1/meetups/:id/images */
const deleteMeetupImage = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.deleteMeetupImage(
    req.params.id, req.user._id, req.user.role, req.body.publicId
  );
  successResponse(res, 'Image removed', { meetup });
});

/** PUT /api/v1/meetups/:id/images/main */
const setMainMeetupImage = asyncHandler(async (req, res) => {
  const { meetup } = await meetupService.setMainMeetupImage(
    req.params.id, req.user._id, req.user.role, req.body.publicId
  );
  successResponse(res, 'Cover photo updated', { meetup });
});

// ─── Participation ────────────────────────────────────────────────────────────

/** POST /api/v1/meetups/:id/interest */
const interestMeetup = asyncHandler(async (req, res) => {
  const result = await meetupService.markInterested(req.params.id, req.user._id);
  successResponse(res, result.interested ? 'Marked as interested' : 'Removed interest', result);
});

/** POST /api/v1/meetups/:id/join */
const joinMeetup = asyncHandler(async (req, res) => {
  const result = await meetupService.joinMeetup(req.params.id, req.user._id);
  successResponse(res, 'Joined meetup successfully', result, 201);
});

/** DELETE /api/v1/meetups/:id/join */
const cancelParticipation = asyncHandler(async (req, res) => {
  const result = await meetupService.cancelParticipation(req.params.id, req.user._id);
  successResponse(res, 'Participation cancelled', result);
});

/** GET /api/v1/meetups/:id/participants */
const getMeetupParticipants = asyncHandler(async (req, res) => {
  const data = await meetupService.getMeetupParticipants(
    req.params.id, req.user._id, req.user.role, req.query
  );
  successResponse(res, 'Participants retrieved', data);
});

/** POST /api/v1/meetups/:id/rsvp  (backward compat — legacy mobile clients) */
const rsvpMeetup = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const result = await meetupService.rsvpMeetup(req.params.id, req.user._id, status);
  successResponse(res, 'RSVP updated', result);
});

// ─── Admin ────────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/meetups/kpis */
const adminGetKPIs = asyncHandler(async (req, res) => {
  const kpis = await meetupService.adminGetKPIs();
  successResponse(res, 'Meetup KPIs retrieved', { kpis });
});

/** GET /api/v1/admin/meetups */
const adminGetAllMeetups = asyncHandler(async (req, res) => {
  const { meetups, pagination } = await meetupService.adminGetAllMeetups(req.query);
  paginatedResponse(res, 'All meetups retrieved', meetups, pagination);
});

/** PUT /api/v1/admin/meetups/:id/lifecycle */
const adminLifecycleTransition = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  if (!status) return errorResponse(res, 'status is required', 400);
  const { meetup } = await meetupService.adminLifecycleTransition(req.params.id, status, req.user._id, reason);
  successResponse(res, `Meetup status updated to ${status}`, { meetup });
});

/** PUT /api/v1/admin/meetups/:id/feature */
const adminToggleFeature = asyncHandler(async (req, res) => {
  const { featured, featuredUntil } = req.body;
  const { meetup } = await meetupService.adminToggleFeature(
    req.params.id,
    featured == null ? undefined : (featured === true || featured === 'true'),
    featuredUntil
  );
  successResponse(res, meetup.isFeatured ? 'Meetup featured' : 'Meetup unfeatured', { meetup });
});

/** PUT /api/v1/admin/meetups/:id/approve  (backward compat) */
const adminToggleApproval = asyncHandler(async (req, res) => {
  const Meetup = require('../models/Meetup.model');
  const existing = await Meetup.findById(req.params.id);
  if (!existing) return errorResponse(res, 'Meetup not found', 404);

  const approve = req.body.approve != null
    ? (req.body.approve === true || req.body.approve === 'true')
    : !existing.isAdminApproved;

  const { meetup } = await meetupService.adminToggleApproval(req.params.id, approve);
  successResponse(res, meetup.isAdminApproved ? 'Meetup approved' : 'Meetup approval revoked', { meetup });
});

/** DELETE /api/v1/admin/meetups/:id */
const adminDeleteMeetup = asyncHandler(async (req, res) => {
  await meetupService.deleteMeetup(req.params.id, req.user._id, 'admin');
  successResponse(res, 'Meetup deleted by admin');
});

module.exports = {
  discoverMeetups,
  getNearbyMeetups,
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
  interestMeetup,
  joinMeetup,
  cancelParticipation,
  getMeetupParticipants,
  rsvpMeetup,
  getMyMeetups,
  adminGetKPIs,
  adminGetAllMeetups,
  adminLifecycleTransition,
  adminToggleFeature,
  adminToggleApproval,
  adminDeleteMeetup,
};

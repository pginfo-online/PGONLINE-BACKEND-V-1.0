const express = require('express');
const router = express.Router();
const {
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
} = require('../../controllers/meetup.controller');
const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

// ─── Public / Optional Auth ───────────────────────────────────────────────────
// optionalAuth attaches req.user if token present but doesn't require it.
// This lets getMeetupById return myParticipation when logged in.

router.get('/discover',  optionalAuth, discoverMeetups);
router.get('/nearby',    optionalAuth, getNearbyMeetups);
router.get('/upcoming',  optionalAuth, getUpcomingMeetups);

// ─── Owner / Admin ────────────────────────────────────────────────────────────
router.get('/my',        protect, authorize('owner', 'admin'), getMyMeetups);

// ─── CRUD (named routes before :id to avoid conflicts) ───────────────────────
router.get('/',          optionalAuth, getMeetups);
router.get('/:id',       optionalAuth, getMeetupById);

router.post('/',         protect, authorize('owner', 'admin'), createMeetup);
router.put('/:id',       protect, authorize('owner', 'admin'), updateMeetup);
router.delete('/:id',    protect, authorize('owner', 'admin'), deleteMeetup);

// Submit for approval
router.put('/:id/publish', protect, authorize('owner', 'admin'), publishMeetup);

// ─── Image Management ─────────────────────────────────────────────────────────
router.post(
  '/:id/images',
  protect, authorize('owner', 'admin'),
  upload.array('images', 8),
  uploadMeetupImages
);
router.delete('/:id/images',      protect, authorize('owner', 'admin'), deleteMeetupImage);
router.put('/:id/images/main',    protect, authorize('owner', 'admin'), setMainMeetupImage);

// ─── Participation ────────────────────────────────────────────────────────────
router.post('/:id/interest',      protect, interestMeetup);
router.post('/:id/join',          protect, joinMeetup);
router.delete('/:id/join',        protect, cancelParticipation);
router.get('/:id/participants',   protect, authorize('owner', 'admin'), getMeetupParticipants);

// Legacy RSVP endpoint — backward compat for old mobile clients
router.post('/:id/rsvp',          protect, rsvpMeetup);

module.exports = router;

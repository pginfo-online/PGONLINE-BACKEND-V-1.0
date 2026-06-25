const express = require('express');
const router = express.Router();
const meetupController = require('../../controllers/meetup.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

router.get('/', protect, meetupController.getMeetups);
router.get('/upcoming', protect, meetupController.getUpcomingMeetups);
router.get('/my', protect, authorize('owner', 'admin'), meetupController.getMyMeetups);
router.get('/:id', protect, meetupController.getMeetupById);
router.post('/', protect, authorize('owner', 'admin'), meetupController.createMeetup);
router.put('/:id', protect, authorize('owner', 'admin'), meetupController.updateMeetup);
router.delete('/:id', protect, authorize('owner', 'admin'), meetupController.deleteMeetup);
router.put('/:id/publish', protect, authorize('owner', 'admin'), meetupController.publishMeetup);
router.post(
  '/:id/images',
  protect,
  authorize('owner', 'admin'),
  upload.array('images', 4),
  meetupController.uploadMeetupImages
);
router.delete('/:id/images', protect, authorize('owner', 'admin'), meetupController.deleteMeetupImage);
router.put('/:id/images/main', protect, authorize('owner', 'admin'), meetupController.setMainMeetupImage);
router.post('/:id/rsvp', protect, meetupController.rsvpMeetup);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics } = require('../../controllers/admin.controller');
const { getAllUpdateRequests, getUpdateRequestById, approveUpdateRequest, rejectUpdateRequest, requestCorrection } = require('../../controllers/pgUpdateRequest.controller');
const { adminGetAllMeetups, adminToggleApproval, adminDeleteMeetup } = require('../../controllers/meetup.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');


// All admin routes require admin role
router.use(protect, authorize('admin'));

router.get('/pgs', getAllPGs);
router.put('/pgs/:id/approve', approvePG);
router.put('/pgs/:id/reject', rejectPG);
router.put('/pgs/:id/verify', toggleVerify);
router.delete('/pgs/:id', removePG);

router.get('/users', getAllUsers);
router.put('/users/:id/suspend', suspendUser);
router.delete('/users/:id', deleteUser);

router.get('/analytics', getAnalytics);

// PG Update Requests
router.get('/pg-updates', getAllUpdateRequests);
router.get('/pg-updates/:id', getUpdateRequestById);
router.put('/pg-updates/:id/approve', approveUpdateRequest);
router.put('/pg-updates/:id/reject', rejectUpdateRequest);
router.put('/pg-updates/:id/correction', requestCorrection);

// Meetups
router.get('/meetups', adminGetAllMeetups);
router.put('/meetups/:id/approve', adminToggleApproval);
router.delete('/meetups/:id', adminDeleteMeetup);

module.exports = router;


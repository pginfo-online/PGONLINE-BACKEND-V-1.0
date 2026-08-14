const express = require('express');
const router = express.Router();
const { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics, createOwner } = require('../../controllers/admin.controller');
const { getAllUpdateRequests, getUpdateRequestById, approveUpdateRequest, rejectUpdateRequest, requestCorrection } = require('../../controllers/pgUpdateRequest.controller');
const { adminGetAllMeetups, adminToggleApproval, adminDeleteMeetup } = require('../../controllers/meetup.controller');
const { directExportPGs, initiateExportJob, getExportJobs, getExportJobStatus, deleteExportJob } = require('../../controllers/adminExport.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const { createOwnerSchema } = require('../../validators/auth.validator');
const { exportQuerySchema, initiateJobSchema } = require('../../validators/adminExport.validator');


// All admin routes require admin role
router.use(protect, authorize('admin'));

// Export PG Listings
router.get('/pgs/export', validate(exportQuerySchema, 'query'), directExportPGs);
router.post('/pgs/export/job', validate(initiateJobSchema, 'body'), initiateExportJob);
router.get('/pgs/export/jobs', getExportJobs);
router.get('/pgs/export/jobs/:id', getExportJobStatus);
router.delete('/pgs/export/jobs/:id', deleteExportJob);

router.get('/pgs', getAllPGs);
router.put('/pgs/:id/approve', approvePG);
router.put('/pgs/:id/reject', rejectPG);
router.put('/pgs/:id/verify', toggleVerify);
router.delete('/pgs/:id', removePG);

router.get('/users', getAllUsers);
router.post('/users', validate(createOwnerSchema), createOwner);
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


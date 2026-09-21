const express = require('express');
const router = express.Router();
const { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics, createOwner, updateUser, resetPassword, updatePGByAdmin, addUserRole, removeUserRole, setUserRoles } = require('../../controllers/admin.controller');
const { getAllUpdateRequests, getUpdateRequestById, approveUpdateRequest, rejectUpdateRequest, requestCorrection } = require('../../controllers/pgUpdateRequest.controller');
const { adminGetAllMeetups, adminGetKPIs, adminLifecycleTransition, adminToggleFeature, adminToggleApproval, adminDeleteMeetup } = require('../../controllers/meetup.controller');
const { directExportPGs, initiateExportJob, getExportJobs, getExportJobStatus, deleteExportJob, getExportScheduleConfig, updateExportScheduleConfig, triggerScheduledExportNow } = require('../../controllers/adminExport.controller');
const { protect, authorize } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const { createOwnerSchema } = require('../../validators/auth.validator');
const { exportQuerySchema, initiateJobSchema } = require('../../validators/adminExport.validator');
const adminNotifCtrl = require('../../controllers/admin.notification.controller');


// All admin routes require admin role
router.use(protect, authorize('admin'));

// Export PG Listings & Datasets
router.get('/pgs/export', validate(exportQuerySchema, 'query'), directExportPGs);
router.post('/pgs/export/job', validate(initiateJobSchema), initiateExportJob);
router.get('/pgs/export/jobs', getExportJobs);
router.get('/pgs/export/jobs/:id', getExportJobStatus);
router.delete('/pgs/export/jobs/:id', deleteExportJob);

// Server-side 9:00 AM Export Schedule
router.get('/pgs/export/schedule', getExportScheduleConfig);
router.put('/pgs/export/schedule', updateExportScheduleConfig);
router.post('/pgs/export/schedule/trigger', triggerScheduledExportNow);

router.get('/pgs', getAllPGs);
router.put('/pgs/:id', updatePGByAdmin);
router.put('/pgs/:id/approve', approvePG);
router.put('/pgs/:id/reject', rejectPG);
router.put('/pgs/:id/verify', toggleVerify);
router.delete('/pgs/:id', removePG);

// Universal Property Management & Approvals
const propertyCtrl = require('../../controllers/property.controller');
const propUpdateCtrl = require('../../controllers/propertyUpdateRequest.controller');
router.get('/properties', propertyCtrl.getAdminProperties);
router.put('/properties/:id/approve', propertyCtrl.approveProperty);
router.put('/properties/:id/reject', propertyCtrl.rejectProperty);
router.put('/properties/:id/request-correction', propertyCtrl.requestCorrection);
router.put('/properties/:id/verify', propertyCtrl.toggleVerify);
router.put('/properties/:id/suspend', propertyCtrl.suspendProperty);
router.get('/property-updates', propUpdateCtrl.getAllUpdateRequests);
router.get('/property-updates/:id', propUpdateCtrl.getUpdateRequestById);
router.put('/property-updates/:id/approve', propUpdateCtrl.approveUpdateRequest);
router.put('/property-updates/:id/reject', propUpdateCtrl.rejectUpdateRequest);
router.put('/property-updates/:id/correction', propUpdateCtrl.requestCorrection);

router.get('/users', getAllUsers);
router.post('/users', validate(createOwnerSchema), createOwner);
router.put('/users/:id', updateUser);
router.put('/users/:id/reset-password', resetPassword);
router.put('/users/:id/suspend', suspendUser);
router.delete('/users/:id', deleteUser);

// User Role Management (multi-role system)
router.put('/users/:id/roles', setUserRoles);
router.post('/users/:id/roles/:role', addUserRole);
router.delete('/users/:id/roles/:role', removeUserRole);

router.get('/analytics', getAnalytics);

// Unified Property / PG Update Requests (supporting both /pg-updates and /property-updates)
router.get('/pg-updates', propUpdateCtrl.getAllUpdateRequests);
router.get('/pg-updates/:id', propUpdateCtrl.getUpdateRequestById);
router.put('/pg-updates/:id/approve', propUpdateCtrl.approveUpdateRequest);
router.put('/pg-updates/:id/reject', propUpdateCtrl.rejectUpdateRequest);
router.put('/pg-updates/:id/correction', propUpdateCtrl.requestCorrection);

router.get('/property-updates', propUpdateCtrl.getAllUpdateRequests);
router.get('/property-updates/:id', propUpdateCtrl.getUpdateRequestById);
router.put('/property-updates/:id/approve', propUpdateCtrl.approveUpdateRequest);
router.put('/property-updates/:id/reject', propUpdateCtrl.rejectUpdateRequest);
router.put('/property-updates/:id/correction', propUpdateCtrl.requestCorrection);

// Meetups
router.get('/meetups/kpis', adminGetKPIs);
router.get('/meetups', adminGetAllMeetups);
router.put('/meetups/:id/lifecycle', adminLifecycleTransition);
router.put('/meetups/:id/feature', adminToggleFeature);
router.put('/meetups/:id/approve', adminToggleApproval);
router.delete('/meetups/:id', adminDeleteMeetup);

// ─── Notification Management ───────────────────────────────────────────────────
router.get('/notifications/stats',                adminNotifCtrl.getStats);
router.post('/notifications/audience-count',      adminNotifCtrl.getAudienceCount);
router.get('/notifications/templates',            adminNotifCtrl.getTemplates);
router.post('/notifications/templates',           adminNotifCtrl.createTemplate);
router.put('/notifications/templates/:id',        adminNotifCtrl.updateTemplate);
router.delete('/notifications/templates/:id',     adminNotifCtrl.deleteTemplate);
router.post('/notifications',                     adminNotifCtrl.createNotification);
router.get('/notifications',                      adminNotifCtrl.getNotifications);
router.get('/notifications/:id',                  adminNotifCtrl.getNotification);
router.put('/notifications/:id',                  adminNotifCtrl.updateNotification);
router.put('/notifications/:id/cancel',           adminNotifCtrl.cancelNotification);
router.post('/notifications/:id/send',            adminNotifCtrl.sendNotification);
router.post('/notifications/:id/retry',           adminNotifCtrl.retryNotification);
router.get('/notifications/:id/receipts',         adminNotifCtrl.getReceipts);

module.exports = router;


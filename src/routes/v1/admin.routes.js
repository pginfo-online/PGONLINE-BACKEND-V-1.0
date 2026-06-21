const express = require('express');
const router = express.Router();
const { getAllPGs, approvePG, rejectPG, toggleVerify, removePG, getAllUsers, suspendUser, deleteUser, getAnalytics } = require('../../controllers/admin.controller');
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

module.exports = router;

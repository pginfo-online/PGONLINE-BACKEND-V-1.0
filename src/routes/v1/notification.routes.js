const express = require('express');
const router  = express.Router();
const { protect } = require('../../middlewares/auth.middleware');

const {
  registerDevice,
  updateDevice,
  removeDevice,
  getMyNotifications,
  getNotificationById,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
} = require('../../controllers/notification.controller');

// All notification routes require authentication
router.use(protect);

// ─── Device Token Management ──────────────────────────────────────────────────
router.post('/devices',          registerDevice);
router.put('/devices/:id',       updateDevice);
router.delete('/devices/:id',    removeDevice);

// ─── Inbox ────────────────────────────────────────────────────────────────────
router.get('/unread-count',      getUnreadCount);   // must be before /:id routes
router.put('/read-all',          markAllRead);
router.get('/',                  getMyNotifications);
router.get('/:id',               getNotificationById);
router.put('/:id/read',          markRead);
router.delete('/:id',            deleteNotification);

// ─── Preferences ──────────────────────────────────────────────────────────────
router.get('/preferences',       getPreferences);
router.put('/preferences',       updatePreferences);

module.exports = router;

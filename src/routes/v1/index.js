const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const pgRoutes = require('./pg.routes');
const leadRoutes = require('./lead.routes');
const visitRoutes = require('./visit.routes');
const adminRoutes = require('./admin.routes');
const uploadRoutes = require('./upload.routes');
const meetupRoutes = require('./meetup.routes');
const appVersionRoutes = require('./appVersion.routes');
const chatbotRoutes = require('./chatbot.routes');
const manageRoutes = require('./manage.routes');
const notificationRoutes = require('./notification.routes');
const cityRoutes = require('./city.routes');
const buffetRoutes = require('./buffet.routes');
const areaRoutes = require('./area.routes');
const meetupCategoryRoutes = require('./meetupCategory.routes');
const hotDealRoutes = require('./hotDeal.routes');
const hotDealCategoryRoutes = require('./hotDealCategory.routes');


router.use('/auth', authRoutes);
router.use('/pg/chat', chatbotRoutes);  // Added chatbot routes under /pg/chat
router.use('/pg', pgRoutes);
router.use('/lead', leadRoutes);
router.use('/visit', visitRoutes);
router.use('/admin', adminRoutes);
router.use('/upload', uploadRoutes);
router.use('/meetups', meetupRoutes);
router.use('/app-version', appVersionRoutes);
router.use('/manage', manageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/cities', cityRoutes);
router.use('/buffet', buffetRoutes);
router.use('/areas', areaRoutes);
router.use('/meetup-categories', meetupCategoryRoutes);
router.use('/hot-deals', hotDealRoutes);
router.use('/hot-deal-categories', hotDealCategoryRoutes);


// API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PGinfo.online API v1',
    endpoints: ['/auth', '/pg', '/lead', '/visit', '/admin', '/upload', '/meetups', '/manage', '/notifications', '/cities', '/buffet'],
  });
});

module.exports = router;

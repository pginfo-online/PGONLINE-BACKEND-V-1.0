const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const pgRoutes = require('./pg.routes');
const leadRoutes = require('./lead.routes');
const visitRoutes = require('./visit.routes');
const adminRoutes = require('./admin.routes');
const uploadRoutes = require('./upload.routes');

router.use('/auth', authRoutes);
router.use('/pg', pgRoutes);
router.use('/lead', leadRoutes);
router.use('/visit', visitRoutes);
router.use('/admin', adminRoutes);
router.use('/upload', uploadRoutes);

// API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PGinfo.online API v1',
    endpoints: ['/auth', '/pg', '/lead', '/visit', '/admin', '/upload'],
  });
});

module.exports = router;

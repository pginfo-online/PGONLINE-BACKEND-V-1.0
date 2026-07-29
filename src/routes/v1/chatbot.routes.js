const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../../middlewares/auth.middleware');
const { sendMessage, finalizeListing, startNewConversation, getActiveConversation } = require('../../controllers/chatbot.controller');

router.use(protect);
router.use(authorize('owner', 'tenant'));

router.get('/active', getActiveConversation);
router.post('/new', startNewConversation);
router.post('/message', sendMessage);
router.post('/finalize', finalizeListing);

module.exports = router;
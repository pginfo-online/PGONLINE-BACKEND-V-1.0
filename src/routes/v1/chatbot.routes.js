const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/chat_temp/' });
const { protect, authorize } = require('../../middlewares/auth.middleware');
const { sendMessage, finalizeListing, startNewConversation, getActiveConversation } = require('../../controllers/chatbot.controller');

router.use(protect);
router.use(authorize('owner', 'tenant'));

router.get('/active', getActiveConversation);
router.post('/new', startNewConversation);
router.post('/message', upload.array('images', 10), sendMessage);
router.post('/finalize', finalizeListing);

module.exports = router;
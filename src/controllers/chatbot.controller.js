const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const chatbotService = require('../services/chatbot.service');

/**
 * POST /api/v1/pg/chat/message
 * Body: { message: string }
 */
const sendMessage = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const message = req.body.message || '';

  const result = await chatbotService.processMessage(userId, message);
  successResponse(res, 'Message processed', result);
});

/**
 * POST /api/v1/pg/chat/finalize
 * Body: { conversationId, listingData: optional overrides }
 */
const finalizeListing = asyncHandler(async (req, res) => {
  const { conversationId, listingData } = req.body;
  const userId = req.user._id;
  const pg = await chatbotService.finalizeListing(userId, conversationId, listingData);
  successResponse(res, 'PG listing created successfully', { pg });
});

/**
 * POST /api/v1/pg/chat/new
 * Starts a fresh conversation for the user
 */
const startNewConversation = asyncHandler(async (req, res) => {
  const conversation = await chatbotService.startNewConversation(req.user._id);
  successResponse(res, 'New conversation started', { conversation });
});

/**
 * GET /api/v1/pg/chat/active
 * Returns the active conversation with listing data preview
 */
const getActiveConversation = asyncHandler(async (req, res) => {
  const conv = await require('../models/Conversation.model')
    .findOne({ user: req.user._id, status: 'active' })
    .sort({ createdAt: -1 })
    .lean();
  successResponse(res, 'Active conversation', { conversation: conv });
});

module.exports = {
  sendMessage,
  finalizeListing,
  startNewConversation,
  getActiveConversation,
};
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    messages: [messageSchema],
    listingData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],
    currentStep: {
      type: String,
      enum: ['init', 'collecting_details', 'awaiting_images', 'confirm_submission', 'completed'],
      default: 'init',
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Conversation', conversationSchema);
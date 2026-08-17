/**
 * expo.service.js
 *
 * Core Expo Push Notification delivery service.
 * Wraps expo-server-sdk with chunking, error classification,
 * receipt polling, and invalid token handling.
 */

const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../../models/DeviceToken.model');
const { logger } = require('../../utils/logger');

// Initialize Expo client (optionally with access token for enhanced throughput)
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  useFcmV1: true, // Use FCM v1 (recommended)
});

const BATCH_SIZE = parseInt(process.env.NOTIFICATION_BATCH_SIZE, 10) || 100;

/**
 * Validate that a token is a valid Expo push token.
 * @param {string} token
 * @returns {boolean}
 */
function isExpoPushToken(token) {
  return Expo.isExpoPushToken(token);
}

/**
 * Send a batch of push messages to Expo.
 * Automatically chunks into groups of BATCH_SIZE (Expo max = 100).
 *
 * @param {Array<Object>} messages - Array of Expo push message objects
 * @returns {Promise<Array<Object>>} tickets - One ticket per message
 */
async function sendBatch(messages) {
  if (!messages || messages.length === 0) return [];

  // Filter out invalid tokens before sending
  const validMessages = messages.filter(msg => {
    if (!isExpoPushToken(msg.to)) {
      logger.warn(`[ExpoService] Skipping invalid push token: ${msg.to}`);
      return false;
    }
    return true;
  });

  if (validMessages.length === 0) return [];

  const chunks = expo.chunkPushNotifications(validMessages);
  const allTickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      allTickets.push(...ticketChunk);
    } catch (err) {
      logger.error(`[ExpoService] Failed to send chunk: ${err.message}`);
      // Return error tickets for this chunk so callers can track failures
      const errorTickets = chunk.map(() => ({
        status: 'error',
        message: err.message,
        details: { error: 'ChunkSendError' },
      }));
      allTickets.push(...errorTickets);
    }
  }

  return allTickets;
}

/**
 * Fetch Expo receipts for a list of push ticket IDs.
 * Expo receipts are available ~5 minutes after sending.
 *
 * @param {string[]} ticketIds
 * @returns {Promise<Object>} Map of ticketId → receipt
 */
async function fetchReceipts(ticketIds) {
  if (!ticketIds || ticketIds.length === 0) return {};

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  const allReceipts = {};

  for (const chunk of receiptIdChunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      Object.assign(allReceipts, receipts);
    } catch (err) {
      logger.error(`[ExpoService] Failed to fetch receipts chunk: ${err.message}`);
    }
  }

  return allReceipts;
}

/**
 * Classify an Expo ticket or receipt error.
 *
 * @param {Object} ticketOrReceipt - Expo ticket or receipt object
 * @returns {{ isInvalid: boolean, shouldRetry: boolean, reason: string }}
 */
function classifyError(ticketOrReceipt) {
  const details = ticketOrReceipt?.details || {};
  const error   = details.error || '';
  const message = ticketOrReceipt?.message || '';

  // Token is no longer registered on the device — deactivate it
  if (error === 'DeviceNotRegistered' || message.includes('DeviceNotRegistered')) {
    return { isInvalid: true, shouldRetry: false, reason: 'DeviceNotRegistered' };
  }

  // Message is too large — don't retry (fix the message)
  if (error === 'MessageTooBig') {
    return { isInvalid: false, shouldRetry: false, reason: 'MessageTooBig' };
  }

  // Rate limit — retry after backoff
  if (error === 'MessageRateExceeded') {
    return { isInvalid: false, shouldRetry: true, reason: 'MessageRateExceeded' };
  }

  // Invalid credentials — don't retry, alert admin
  if (error === 'InvalidCredentials') {
    return { isInvalid: false, shouldRetry: false, reason: 'InvalidCredentials' };
  }

  // Unknown error — allow one retry
  if (ticketOrReceipt?.status === 'error') {
    return { isInvalid: false, shouldRetry: true, reason: error || 'UnknownError' };
  }

  return { isInvalid: false, shouldRetry: false, reason: 'ok' };
}

/**
 * Mark a DeviceToken as inactive because Expo reported it as unregistered.
 * @param {string} token - Expo push token string
 */
async function handleInvalidToken(token) {
  try {
    await DeviceToken.findOneAndUpdate(
      { token },
      {
        isActive: false,
        deactivatedReason: 'DeviceNotRegistered',
      }
    );
    logger.info(`[ExpoService] Deactivated invalid token: ${token}`);
  } catch (err) {
    logger.error(`[ExpoService] Failed to deactivate token ${token}: ${err.message}`);
  }
}

/**
 * Build a single Expo message object.
 *
 * @param {string} token - Expo push token
 * @param {Object} payload - { title, body, imageUrl, data, sound, badge, ttl }
 * @returns {Object} Expo message object
 */
function buildMessage(token, payload) {
  const msg = {
    to:    token,
    title: payload.title,
    body:  payload.body,
    data:  payload.data   || {},
    sound: payload.sound  || 'default',
    badge: payload.badge  || 1,
    ttl:   payload.ttl    || 86400, // 24 hours default
    priority: payload.priority || 'high',
    channelId: payload.channelId || 'default',
    mutableContent: true,
  };

  // Rich notification: attach image if provided
  if (payload.imageUrl) {
    msg.image = payload.imageUrl;  // Expo Push API / FCM notification.image
    msg.data.imageUrl = payload.imageUrl;
    msg.data.image = payload.imageUrl;
  }

  return msg;
}

module.exports = {
  isExpoPushToken,
  sendBatch,
  fetchReceipts,
  classifyError,
  handleInvalidToken,
  buildMessage,
};

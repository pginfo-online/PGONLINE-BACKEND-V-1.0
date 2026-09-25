const axios = require('axios');
const { logger } = require('../../utils/logger');

/**
 * WhatsApp Service — Meta Cloud API Integration
 *
 * Production-grade WhatsApp Business API service for:
 * - Sending template messages (rent reminders, receipts, welcome, overdue)
 * - Dynamic variable substitution
 * - Delivery status tracking
 * - Rate limiting awareness
 * - Error categorization and retry guidance
 *
 * Environment variables:
 *   WHATSAPP_PHONE_NUMBER_ID   — Your WhatsApp Business phone number ID
 *   WHATSAPP_ACCESS_TOKEN      — Permanent system user access token
 *   WHATSAPP_BUSINESS_ID       — WhatsApp Business Account ID
 *   WHATSAPP_API_VERSION       — API version (default: v21.0)
 */

const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// ─── Template Names (must match templates created in Meta Business Manager) ──
const TEMPLATES = {
  RENT_RECEIPT:           'rent_receipt',
  RENT_REMINDER:          'rent_reminder',
  RENT_OVERDUE:           'rent_overdue',
  PAYMENT_CONFIRMATION:   'payment_confirmation',
  WELCOME_TENANT:         'welcome_tenant',
  LEASE_EXPIRY_REMINDER:  'lease_expiry_reminder',
  VACANCY_ALERT:          'vacancy_alert',
};

/**
 * Get configured Axios instance for WhatsApp API.
 */
const getClient = () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp API credentials not configured (WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID / META_WHATSAPP_PHONE_NUMBER_ID)');
  }

  return {
    client: axios.create({
      baseURL: `${BASE_URL}/${phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }),
    phoneNumberId,
  };
};

/**
 * Format phone number to WhatsApp-compatible format.
 * Accepts: 9876543210, +919876543210, 919876543210
 * Returns: 919876543210
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (/^\d{10}$/.test(cleaned)) return `91${cleaned}`;
  if (/^91\d{10}$/.test(cleaned)) return cleaned;
  return cleaned;
};

/**
 * Send a template message via WhatsApp Cloud API.
 *
 * @param {string} to           — Recipient phone number
 * @param {string} templateName — Template name (from TEMPLATES enum)
 * @param {string} languageCode — Template language (default: en)
 * @param {Array}  bodyParams   — Template body parameter values (strings)
 * @param {Array}  [headerParams] — Template header parameter values (optional)
 * @param {Array}  [buttons]      — Template button parameters (optional)
 * @returns {object} { success, messageId, error }
 */
const sendTemplate = async (to, templateName, languageCode = 'en', bodyParams = [], headerParams = [], buttons = []) => {
  try {
    const formattedPhone = formatPhoneNumber(to);
    if (!formattedPhone) {
      return { success: false, error: 'Invalid phone number' };
    }

    const { client } = getClient();

    // Build components array
    const components = [];

    // Header parameters (if any)
    if (headerParams.length > 0) {
      components.push({
        type: 'header',
        parameters: headerParams.map((val) => ({
          type: 'text',
          text: String(val),
        })),
      });
    }

    // Body parameters
    if (bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((val) => ({
          type: 'text',
          text: String(val),
        })),
      });
    }

    // Button parameters (e.g., URL buttons with dynamic suffix)
    if (buttons.length > 0) {
      buttons.forEach((btn, index) => {
        components.push({
          type: 'button',
          sub_type: btn.sub_type || 'url',
          index,
          parameters: [{
            type: 'text',
            text: String(btn.value),
          }],
        });
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components.length > 0 ? components : undefined,
      },
    };

    const response = await client.post('/messages', payload);

    const messageId = response.data?.messages?.[0]?.id;
    logger.info(`[WhatsApp] Template "${templateName}" sent to ${formattedPhone} → msgId: ${messageId}`);

    return {
      success: true,
      messageId,
      recipientPhone: formattedPhone,
    };
  } catch (err) {
    const errorData = err.response?.data?.error;
    const errorCode = errorData?.code;
    const errorMessage = errorData?.message || err.message;

    // Categorize errors for retry decisions
    const isRetryable = [
      131048, // Rate limit hit
      131031, // Business account locked
      130472, // Experiment rate limit
    ].includes(errorCode);

    logger.error(`[WhatsApp] Failed to send "${templateName}" to ${to}: ${errorMessage} (code: ${errorCode})`);

    return {
      success: false,
      error: errorMessage,
      errorCode,
      isRetryable,
    };
  }
};

// ─── Convenience Methods for Each Template ──────────────────────────────────

/**
 * Send rent reminder to tenant.
 */
const sendRentReminder = async (tenantPhone, data) => {
  const { tenantName, pgName, roomNumber, amount, dueDate, pgNameMgmt } = data;
  return sendTemplate(tenantPhone, TEMPLATES.RENT_REMINDER, 'en', [
    tenantName, pgName, roomNumber, String(amount), dueDate, pgNameMgmt || pgName,
  ]);
};

/**
 * Send overdue rent alert to tenant.
 */
const sendRentOverdue = async (tenantPhone, data) => {
  const { tenantName, pgName, roomNumber, amount, dueDate, daysOverdue, pgNameMgmt } = data;
  return sendTemplate(tenantPhone, TEMPLATES.RENT_OVERDUE, 'en', [
    tenantName, pgName, roomNumber, String(amount), dueDate, String(daysOverdue), pgNameMgmt || pgName,
  ]);
};

/**
 * Send payment confirmation to tenant.
 */
const sendPaymentConfirmation = async (tenantPhone, data) => {
  const { tenantName, pgName, roomNumber, amount, paymentMethod, paymentDate, receiptNo, pgNameMgmt } = data;
  return sendTemplate(tenantPhone, TEMPLATES.PAYMENT_CONFIRMATION, 'en', [
    tenantName, pgName, roomNumber, String(amount), paymentMethod, paymentDate, receiptNo, pgNameMgmt || pgName,
  ]);
};

/**
 * Send welcome message to new tenant.
 */
const sendWelcomeTenant = async (tenantPhone, data) => {
  const { tenantName, pgName, roomNumber, bedLabel, joinDate, monthlyRent, pgNameMgmt } = data;
  return sendTemplate(tenantPhone, TEMPLATES.WELCOME_TENANT, 'en', [
    tenantName, pgName, roomNumber, bedLabel, joinDate, String(monthlyRent), pgNameMgmt || pgName,
  ]);
};

/**
 * Send lease/lock-in expiry reminder.
 */
const sendLeaseExpiryReminder = async (tenantPhone, data) => {
  const { tenantName, pgName, expiryDate, noticePeriod, pgNameMgmt } = data;
  return sendTemplate(tenantPhone, TEMPLATES.LEASE_EXPIRY_REMINDER, 'en', [
    tenantName, pgName, expiryDate, String(noticePeriod), pgNameMgmt || pgName,
  ]);
};

/**
 * Send vacancy alert to owner.
 */
const sendVacancyAlert = async (ownerPhone, data) => {
  const { pgName, roomNumber, bedLabel, tenantName, vacateDate, totalVacant } = data;
  return sendTemplate(ownerPhone, TEMPLATES.VACANCY_ALERT, 'en', [
    pgName, roomNumber, bedLabel, tenantName, vacateDate, String(totalVacant),
  ]);
};

/**
 * Send rent receipt via WhatsApp (existing template).
 */
const sendRentReceipt = async (tenantPhone, data) => {
  return sendTemplate(tenantPhone, TEMPLATES.RENT_RECEIPT, 'en', data.bodyParams || [], data.headerParams || []);
};

module.exports = {
  TEMPLATES,
  sendTemplate,
  sendRentReminder,
  sendRentOverdue,
  sendPaymentConfirmation,
  sendWelcomeTenant,
  sendLeaseExpiryReminder,
  sendVacancyAlert,
  sendRentReceipt,
  formatPhoneNumber,
};

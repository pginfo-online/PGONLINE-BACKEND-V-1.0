'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { Resend } = require('resend');
const Otp = require('../models/Otp.model');
const { logger } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 4-digit numeric OTP
 * @returns {string} 4-digit string
 */
const generateOtp = () => crypto.randomInt(1000, 10000).toString();

/**
 * Build the throttle-aware error for rate limiting
 */
const buildRateLimitError = (message, statusCode = 429, retryAfter = 0) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.retryAfter = retryAfter; // seconds until user can retry
  return error;
};

// ─────────────────────────────────────────────────────────────────────────────
// Channel 1 — Email via Resend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send OTP email using Resend
 * @param {string} email
 * @param {string} otpCode
 * @param {'login'|'register'|'unified'} purpose
 */
const sendOtpEmail = async (email, otpCode, purpose = 'login') => {
  const emailLower = email.toLowerCase().trim();

  if (!process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is not defined in environment variables.');
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'developement'
    ) {
      logger.info(`[DEV FALLBACK] Email OTP for ${emailLower}: ${otpCode}`);
      return { success: true, devFallback: true };
    }
    throw Object.assign(
      new Error('Email service configuration missing. Contact administrator.'),
      { statusCode: 500 }
    );
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const subject =
    purpose === 'register'
      ? 'Verify your email — PGinfo.online'
      : 'Your Login OTP — PGinfo.online';
  const actionText =
    purpose === 'register' ? 'creating your account' : 'signing in';

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px 20px;">
      <div style="background: #fff; border-radius: 16px; padding: 36px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.07);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #4f46e5; font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">PGinfo.online</h1>
          <p style="color: #6b7280; font-size: 13px; margin-top: 4px;">Find your perfect PG, zero brokerage</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 24px;" />
        <p style="color: #374151; font-size: 15px; margin: 0 0 8px;">Hello,</p>
        <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">
          You requested a One-Time Password (OTP) for <strong>${actionText}</strong> on PGinfo.online.
        </p>
        <div style="background: linear-gradient(135deg, #eef2ff, #f5f3ff); border: 2px dashed #c7d2fe; border-radius: 12px; text-align: center; padding: 24px 20px; margin: 0 0 24px;">
          <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px;">Your OTP Code</p>
          <span style="font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #4f46e5;">${otpCode}</span>
        </div>
        <p style="color: #4b5563; font-size: 13px; line-height: 1.6; margin: 0 0 12px;">
          This code is valid for <strong>5 minutes</strong>. If you did not request this code, please ignore this email.
        </p>
        <p style="color: #ef4444; font-size: 12px; font-weight: 700; margin: 0 0 24px;">
          ⚠️ Never share this OTP with anyone — our team will never ask for it.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 16px;" />
        <p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0;">
          This is an automated message. Please do not reply.<br />
          © ${new Date().getFullYear()} PGinfo.online. All rights reserved.
        </p>
      </div>
    </div>
  `;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `PGinfo.online <${fromEmail}>`,
      to: emailLower,
      subject,
      html,
    });
    logger.info(`OTP email sent to ${emailLower} for "${purpose}"`);
    return { success: true };
  } catch (err) {
    logger.error(`Failed to send OTP email to ${emailLower}: ${err.message}`);
    throw Object.assign(
      new Error('Failed to send verification email. Please try again.'),
      { statusCode: 500 }
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Channel 2 — SMS via Ping4SMS (AllCloud) — GET API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build and send an SMS via Ping4SMS HTTP GET API
 * @param {string} phone - 10-digit Indian mobile number
 * @param {string} otpCode
 * @returns {{ success: boolean, messageId?: string }}
 */
const sendOtpSms = async (phone, otpCode) => {
  const baseUrl =
    process.env.PING4SMS_BASE_URL ||
    'https://site.ping4sms.com/api/smsapi';

  const apiKey = process.env.PING4SMS_API_KEY;
  const senderId = process.env.PING4SMS_SENDER_ID || 'PNGOTP';

  // Your working Postman request uses route=2
  const route = process.env.PING4SMS_SMS_ROUTE || '2';

  const templateId = process.env.PING4SMS_DLT_TEMPLATE_ID || '1507165967974501361';

  // -------------------------------------------------------
  // 1. Validate configuration
  // -------------------------------------------------------

  if (!baseUrl || !apiKey || !senderId) {
    logger.warn('PING4SMS SMS credentials are not configured.');

    if (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'developement'
    ) {
      logger.info(
        `[DEV FALLBACK] SMS OTP for ${phone}: ${otpCode}`
      );

      return {
        success: true,
        devFallback: true,
      };
    }

    throw Object.assign(
      new Error(
        'SMS service configuration missing. Contact administrator.'
      ),
      {
        statusCode: 500,
      }
    );
  }

  // -------------------------------------------------------
  // 2. Normalize phone number
  // -------------------------------------------------------

  let normalizedPhone = String(phone).replace(/\D/g, '');

  // 8010097706 -> 918010097706
  if (normalizedPhone.length === 10) {
    normalizedPhone = `91${normalizedPhone}`;
  }

  // 098010097706 -> 9198010097706
  if (
    normalizedPhone.startsWith('0') &&
    normalizedPhone.length === 11
  ) {
    normalizedPhone = `91${normalizedPhone.substring(1)}`;
  }

  // Already in 91XXXXXXXXXX format
  if (
    !normalizedPhone.startsWith('91') ||
    normalizedPhone.length !== 12
  ) {
    throw Object.assign(
      new Error('Invalid Indian mobile number.'),
      {
        statusCode: 400,
      }
    );
  }

  // -------------------------------------------------------
  // 3. Validate OTP
  // -------------------------------------------------------

  const otp = String(otpCode).trim();

  if (!/^\d{4}$/.test(otp)) {
    throw Object.assign(
      new Error('OTP must be exactly 4 digits.'),
      {
        statusCode: 400,
      }
    );
  }

  // -------------------------------------------------------
  // 4. DLT-approved SMS template
  // -------------------------------------------------------
  //
  // Approved template:
  //
  // Dear Customer,{#var#} is your verification code -PNGOTP
  //
  // Example:
  //
  // Dear Customer,1234 is your verification code -PNGOTP
  //

  const message =
    `Dear Customer,${otp} is your verification code -PNGOTP`;

  // -------------------------------------------------------
  // 5. Build request parameters
  // -------------------------------------------------------

  const params = {
    key: apiKey,
    route,
    sender: senderId,
    number: normalizedPhone,
    sms: message,
  };

  // Only send templateid if configured
  if (templateId) {
    params.templateid = templateId;
  }

  // -------------------------------------------------------
  // 6. Send SMS
  // -------------------------------------------------------

  try {
    // logger.info(
    //   `Sending OTP SMS to ${normalizedPhone} via PING4SMS`
    // );

    const response = await axios.get(baseUrl, {
      params,
      timeout: 15000,
    });

    // PING4SMS legacy API can return a plain text value.
    const responseData = String(response.data ?? '').trim();

    // logger.info(
    //   `PING4SMS response for ${normalizedPhone}: ${responseData}`
    // );

    // -----------------------------------------------------
    // 7. Handle empty response
    // -----------------------------------------------------

    if (!responseData) {
      throw Object.assign(
        new Error('PING4SMS returned an empty response.'),
        {
          statusCode: 502,
        }
      );
    }

    // -----------------------------------------------------
    // 8. Detect legacy API error response
    // -----------------------------------------------------
    //
    // Legacy endpoint may return short numeric error codes.
    // A normal successful response such as:
    //
    // 158673403
    //
    // is a message ID and must NOT be treated as an error.
    //

    const isShortNumericError =
      /^\d{3}$/.test(responseData);

    if (isShortNumericError) {
      logger.error(
        `PING4SMS returned error code ${responseData} for ${normalizedPhone}`
      );

      throw Object.assign(
        new Error(
          `SMS gateway error (code ${responseData}).`
        ),
        {
          statusCode: 502,
          providerCode: responseData,
        }
      );
    }

    // -----------------------------------------------------
    // 9. Successful SMS submission
    // -----------------------------------------------------

    logger.info(
      `PING4SMS SMS submitted successfully. ` +
      `Phone: ${normalizedPhone}, ` +
      `Message ID: ${responseData}`
    );

    return {
      success: true,
      messageId: responseData,
      phone: normalizedPhone,
    };
  } catch (err) {
    // Re-throw our own application errors
    if (err.statusCode) {
      throw err;
    }

    // Axios/provider error
    const providerResponse =
      err.response?.data ?? err.message;

    logger.error(
      `PING4SMS request failed for ${normalizedPhone}:`,
      providerResponse
    );

    throw Object.assign(
      new Error(
        'Failed to send verification SMS. Please try again.'
      ),
      {
        statusCode: 502,
      }
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Channel 3 — WhatsApp via Ping4SMS (route=6) + Meta fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send OTP via WhatsApp using Ping4SMS route=6
 * Falls back gracefully — never throws; logs errors only.
 * @param {string} phone - 10-digit Indian mobile number
 * @param {string} otpCode
 * @returns {{ success: boolean, channel: 'whatsapp', error?: string }}
 */
const sendOtpWhatsApp = async (phone, otpCode) => {
  const baseUrl = process.env.PING4SMS_BASE_URL;
  const apiKey = process.env.PING4SMS_API_KEY;
  const senderId = process.env.PING4SMS_WHATSAPP_SENDER_ID || process.env.PING4SMS_SENDER_ID;
  const route = process.env.PING4SMS_WHATSAPP_ROUTE || '6';
  const templateId = process.env.PING4SMS_WHATSAPP_TEMPLATE_ID;

  if (!baseUrl || !apiKey || !senderId) {
    logger.warn('Ping4SMS WhatsApp credentials not configured — skipping WhatsApp delivery.');
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'developement'
    ) {
      logger.info(`[DEV FALLBACK] WhatsApp OTP for ${phone}: ${otpCode}`);
      return { success: true, channel: 'whatsapp', devFallback: true };
    }
    return { success: false, channel: 'whatsapp', error: 'WhatsApp not configured' };
  }

  const message =
    `🔐 *PGinfo.online OTP*\n\n` +
    `Your one-time password is: *${otpCode}*\n\n` +
    `Valid for *5 minutes*. Do NOT share this code with anyone.\n\n` +
    `_This is an automated message from PGinfo.online_`;

  const params = new URLSearchParams({
    key: apiKey,
    route,
    sender: senderId,
    number: phone,
    sms: message,
    ...(templateId &&
      templateId !== 'YOUR_WHATSAPP_DLT_TEMPLATE_ID_HERE' && { templateid: templateId }),
  });

  const url = `${baseUrl}?${params.toString()}`;

  try {
    const response = await axios.get(url, { timeout: 15000 });
    const responseData = response.data?.toString().trim();

    if (responseData && /^1\d{2}$/.test(responseData)) {
      logger.warn(`Ping4SMS WhatsApp error for ${phone}: code ${responseData}`);
      return { success: false, channel: 'whatsapp', error: `Gateway error ${responseData}` };
    }

    logger.info(`WhatsApp OTP sent to ${phone}. Message ID: ${responseData}`);
    return { success: true, channel: 'whatsapp', messageId: responseData };
  } catch (err) {
    logger.error(
      `WhatsApp delivery failed for ${phone}: ${err.response?.data || err.message}`
    );
    // Graceful — don't throw; SMS was already sent
    return { success: false, channel: 'whatsapp', error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// OTP CRUD — shared throttling helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply throttle checks (60s cooldown + 5/15min cap) for a given query
 */
const applyOtpThrottle = async (query, purpose) => {
  const COOLDOWN_MS = 60_000;
  const WINDOW_MS = 15 * 60_000;
  const MAX_PER_WINDOW = 5;

  const latestOtp = await Otp.findOne({ ...query, purpose }).sort({ createdAt: -1 });
  if (latestOtp && Date.now() - latestOtp.createdAt.getTime() < COOLDOWN_MS) {
    const remaining = Math.ceil(
      (COOLDOWN_MS - (Date.now() - latestOtp.createdAt.getTime())) / 1000
    );
    throw buildRateLimitError(
      `Please wait ${remaining} second${remaining !== 1 ? 's' : ''} before requesting a new OTP.`,
      429,
      remaining  // ← retryAfter in seconds passed to client
    );
  }

  const windowStart = new Date(Date.now() - WINDOW_MS);
  const recentCount = await Otp.countDocuments({
    ...query,
    purpose,
    createdAt: { $gte: windowStart },
  });
  if (recentCount >= MAX_PER_WINDOW) {
    throw buildRateLimitError(
      'Too many OTP requests. Please try again in 15 minutes.',
      429,
      900 // 15 min in seconds
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// createOtp — email-only legacy flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and send OTP for standard email flows (register / login)
 * @param {string} email
 * @param {'register'|'login'} purpose
 */
const createOtp = async (email, purpose) => {
  const emailLower = email.toLowerCase().trim();
  const query = { email: emailLower };

  await applyOtpThrottle(query, purpose);

  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  await Otp.create({ email: emailLower, otp: otpCode, purpose, expiresAt });
  await sendOtpEmail(emailLower, otpCode, purpose);

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// createOtpUnified — multi-channel: email | phone (SMS + optional WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and send OTP for unified flow (email or phone).
 * When phone is supplied:
 *   - Always sends SMS (Ping4SMS route=4)
 *   - Also sends WhatsApp (Ping4SMS route=6) if sendWhatsApp=true (default)
 *
 * @param {{ email?: string, phone?: string, sendWhatsApp?: boolean }} options
 * @returns {{ success: boolean, channels: string[] }}
 */
const createOtpUnified = async ({ email, phone, sendWhatsApp = true }) => {
  const identifier = email || phone;
  if (!identifier) {
    throw Object.assign(new Error('Email or phone number is required'), { statusCode: 400 });
  }

  const emailNorm = email ? email.toLowerCase().trim() : undefined;
  const phoneNorm = phone ? phone.trim() : undefined;
  const query = emailNorm ? { email: emailNorm } : { phone: phoneNorm };

  await applyOtpThrottle(query, 'unified');

  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  await Otp.create({ ...query, otp: otpCode, purpose: 'unified', expiresAt });

  const channels = [];
  const deliveryErrors = [];

  if (emailNorm) {
    // ── Email channel ──────────────────────────────────────────────────────
    await sendOtpEmail(emailNorm, otpCode, 'unified');
    channels.push('email');
  }

  if (phoneNorm) {
    // ── SMS channel (always, if phone provided) ────────────────────────────
    try {
      await sendOtpSms(phoneNorm, otpCode);
      channels.push('sms');
    } catch (smsErr) {
      logger.error(`SMS delivery failed for ${phoneNorm}: ${smsErr.message}`);
      deliveryErrors.push({ channel: 'sms', error: smsErr.message });
    }

    // ── WhatsApp channel (optional, simultaneous, non-blocking) ───────────
    if (sendWhatsApp) {
      const waResult = await sendOtpWhatsApp(phoneNorm, otpCode);
      if (waResult.success) {
        channels.push('whatsapp');
      } else {
        deliveryErrors.push({ channel: 'whatsapp', error: waResult.error });
      }
    }

    // If ALL phone channels failed, surface the error to the caller
    const phoneChannels = channels.filter((c) => c === 'sms' || c === 'whatsapp');
    if (phoneChannels.length === 0) {
      throw Object.assign(
        new Error('Failed to deliver OTP. Please try again.'),
        { statusCode: 500 }
      );
    }
  }

  if (deliveryErrors.length > 0) {
    logger.warn(`Some OTP channels failed: ${JSON.stringify(deliveryErrors)}`);
  }

  logger.info(`OTP created and sent via: ${channels.join(', ')} for ${identifier}`);
  return { success: true, channels };
};

// ─────────────────────────────────────────────────────────────────────────────
// verifyOtpUnified
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify OTP in the unified flow (email or phone)
 * @param {{ email?: string, phone?: string, otp: string }}
 * @returns {true}
 * @throws on invalid / expired / too-many-attempts
 */
const verifyOtpUnified = async ({ email, phone, otp }) => {
  const emailNorm = email ? email.toLowerCase().trim() : undefined;
  const phoneNorm = phone ? phone.trim() : undefined;
  const query = emailNorm ? { email: emailNorm } : { phone: phoneNorm };

  const otpRecord = await Otp.findOne({
    ...query,
    purpose: 'unified',
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    throw Object.assign(
      new Error('OTP not found. Please request a new OTP.'),
      { statusCode: 404 }
    );
  }
  if (otpRecord.expiresAt < new Date()) {
    throw Object.assign(
      new Error('OTP has expired. Please request a new OTP.'),
      { statusCode: 400 }
    );
  }
  if (otpRecord.attempts >= 5) {
    throw Object.assign(
      new Error('Too many incorrect attempts. Please request a new OTP.'),
      { statusCode: 400 }
    );
  }

  otpRecord.attempts += 1;
  if (otpRecord.otp !== otp) {
    await otpRecord.save();
    const remaining = 5 - otpRecord.attempts;
    throw Object.assign(
      new Error(`Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`),
      { statusCode: 400 }
    );
  }

  otpRecord.verified = true;
  await otpRecord.save();
  logger.info(`OTP verified successfully for ${emailNorm || phoneNorm}`);
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// verifyOtp — legacy email-only flow (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify standard email OTP (register / login)
 * @param {string} email
 * @param {'register'|'login'} purpose
 * @param {string} otp
 */
const verifyOtp = async (email, purpose, otp) => {
  const emailLower = email.toLowerCase().trim();

  const otpRecord = await Otp.findOne({
    email: emailLower,
    purpose,
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    throw Object.assign(
      new Error('OTP not found. Please request a new OTP.'),
      { statusCode: 404 }
    );
  }
  if (otpRecord.expiresAt < new Date()) {
    throw Object.assign(
      new Error('OTP has expired. Please request a new OTP.'),
      { statusCode: 400 }
    );
  }
  if (otpRecord.attempts >= 5) {
    throw Object.assign(
      new Error('Too many incorrect attempts. Please request a new OTP.'),
      { statusCode: 400 }
    );
  }

  otpRecord.attempts += 1;
  if (otpRecord.otp !== otp) {
    await otpRecord.save();
    const remaining = 5 - otpRecord.attempts;
    throw Object.assign(
      new Error(`Invalid OTP. You have ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`),
      { statusCode: 400 }
    );
  }

  otpRecord.verified = true;
  await otpRecord.save();
  logger.info(`OTP verified for ${emailLower} (${purpose})`);
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateOtp,
  sendOtpEmail,
  sendOtpSms,
  sendOtpWhatsApp,
  createOtp,
  verifyOtp,
  createOtpUnified,
  verifyOtpUnified,
};
const crypto = require('crypto');
const axios = require('axios');                     // for SMS API
const { Resend } = require('resend');
const Otp = require('../models/Otp.model');
const { logger } = require('../utils/logger');

/**
 * Generate a cryptographically secure 4‑digit numeric OTP
 */
const generateOtp = () => {
  return crypto.randomInt(1000, 10000).toString();  // 4 digits
};

/**
 * Send OTP email using Resend (unchanged)
 */
const sendOtpEmail = async (email, otpCode, purpose = 'login') => {
  const emailLower = email.toLowerCase().trim();

  if (!process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is not defined in environment variables.');
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'developement') {
      logger.info(`[DEV FALLBACK] Generated OTP for ${emailLower}: ${otpCode}`);
      return { success: true, devFallback: true };
    }
    const error = new Error('Email service configuration missing. Contact administrator.');
    error.statusCode = 500;
    throw error;
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const subject = purpose === 'register' ? 'Verify your email - PGinfo.online' : 'Your Login OTP - PGinfo.online';
  const actionText = purpose === 'register' ? 'creating your account' : 'signing in';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #4f46e5; text-align: center; margin-bottom: 5px;">PGinfo.online</h2>
      <p style="text-align: center; color: #6b7280; font-size: 14px; margin-top: 0;">Find your perfect PG, no brokerage</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p>Hello,</p>
      <p>You requested a One-Time Password (OTP) for ${actionText} on PGinfo.online.</p>
      <div style="background-color: #f3f4f6; padding: 18px; border-radius: 8px; text-align: center; margin: 25px 0;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #4f46e5;">${otpCode}</span>
      </div>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">This code is valid for <strong>5 minutes</strong>. If you did not request this code, please ignore this email.</p>
      <p style="color: #ef4444; font-size: 12px; font-weight: bold; margin-top: 15px;">⚠️ For security reasons, do not share this OTP with anyone.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px; margin-bottom: 20px;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">This is an automated message. Please do not reply directly to this email.<br>© 2026 PGinfo.online. All rights reserved.</p>
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
    logger.info(`OTP email sent successfully to ${emailLower} for ${purpose}`);
    return { success: true };
  } catch (sendError) {
    logger.error(`Failed to send OTP email via Resend to ${emailLower}: ${sendError.message}`);
    const error = new Error('Failed to send verification email. Please try again.');
    error.statusCode = 500;
    throw error;
  }
};

/**
 * Send OTP SMS via the provided SMS gateway
 */
const sendOtpSms = async (phone, otpCode) => {
  const message =
    `Dear User ,Your WorknAi - PGInfo login verification code is ${otpCode}.` +
    `This OTP is valid for 5 minutes.` +
    `Do not share this OTP with anyone.` +
    ` WorknAi- PGInfo`;

  const params = new URLSearchParams();

  params.append('mobile', process.env.SMS_USERNAME);
  params.append('pass', process.env.SMS_PASSWORD);
  params.append('senderid', process.env.SMS_SENDER_ID);
  params.append('to', phone);
  params.append('msg', message);

  try {
    const response = await axios.post(
      process.env.SMS_API_URL,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    logger.info(
      `SMS API response for ${phone}: ${JSON.stringify(response.data)}`
    );

    return response.data;
  } catch (err) {
    logger.error(
      `Failed to send SMS to ${phone}: ${
        err.response?.data || err.message
      }`
    );

    const error = new Error(
      'Failed to send verification SMS. Please try again.'
    );

    error.statusCode = 500;
    throw error;
  }
};

/**
 * Create and send OTP for email‑only flows (unchanged)
 */
const createOtp = async (email, purpose) => {
  const emailLower = email.toLowerCase().trim();

  // Throttle: 60 seconds
  const latestOtp = await Otp.findOne({ email: emailLower, purpose }).sort({ createdAt: -1 });
  if (latestOtp && Date.now() - latestOtp.createdAt.getTime() < 60000) {
    const remainingSeconds = Math.ceil((60000 - (Date.now() - latestOtp.createdAt.getTime())) / 1000);
    const error = new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP`);
    error.statusCode = 429;
    throw error;
  }

  // Max 5 OTP requests in 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const recentCount = await Otp.countDocuments({
    email: emailLower,
    createdAt: { $gte: fifteenMinutesAgo },
  });
  if (recentCount >= 5) {
    const error = new Error('Too many OTP requests. Please try again in 15 minutes.');
    error.statusCode = 429;
    throw error;
  }

  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await Otp.create({
    email: emailLower,
    otp: otpCode,
    purpose,
    expiresAt,
  });

  await sendOtpEmail(emailLower, otpCode, purpose);
  return { success: true };
};

/**
 * Create OTP for unified email/phone authentication
 */
const createOtpUnified = async ({ email, phone }) => {
  const identifier = email || phone;
  if (!identifier) {
    const error = new Error('Email or phone number is required');
    error.statusCode = 400;
    throw error;
  }

  // Correctly store/find by phone OR email, not mixing fields
  const query = email
    ? { email: email.toLowerCase().trim() }
    : { phone: phone.trim() };

  // 60‑second throttle
  const latestOtp = await Otp.findOne({ ...query, purpose: 'unified' }).sort({ createdAt: -1 });
  if (latestOtp && Date.now() - latestOtp.createdAt.getTime() < 60000) {
    const remainingSeconds = Math.ceil((60000 - (Date.now() - latestOtp.createdAt.getTime())) / 1000);
    const error = new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP`);
    error.statusCode = 429;
    throw error;
  }

  // Max 5 requests in 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const recentCount = await Otp.countDocuments({
    ...query,
    purpose: 'unified',
    createdAt: { $gte: fifteenMinutesAgo },
  });
  if (recentCount >= 5) {
    const error = new Error('Too many OTP requests. Please try again in 15 minutes.');
    error.statusCode = 429;
    throw error;
  }

  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await Otp.create({
    ...query,
    otp: otpCode,
    purpose: 'unified',
    expiresAt,
  });

  // Send via the appropriate channel
  if (email) {
    await sendOtpEmail(email.toLowerCase().trim(), otpCode, 'unified');
  }
  if (phone) {
    await sendOtpSms(phone.trim(), otpCode);
  }

  return { success: true };
};

/**
 * Verify unified OTP
 */
const verifyOtpUnified = async ({ email, phone, otp }) => {
  const query = email
    ? { email: email.toLowerCase().trim() }
    : { phone: phone.trim() };

  const otpRecord = await Otp.findOne({
    ...query,
    purpose: 'unified',
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    const error = new Error('OTP not found. Please request a new OTP.');
    error.statusCode = 404;
    throw error;
  }
  if (otpRecord.expiresAt < new Date()) {
    const error = new Error('OTP has expired. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }
  if (otpRecord.attempts >= 5) {
    const error = new Error('Too many incorrect attempts. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  otpRecord.attempts += 1;
  if (otpRecord.otp !== otp) {
    await otpRecord.save();
    const remaining = 5 - otpRecord.attempts;
    const error = new Error(`Invalid OTP. ${remaining} attempts remaining.`);
    error.statusCode = 400;
    throw error;
  }

  otpRecord.verified = true;
  await otpRecord.save();
  logger.info(`OTP verified successfully for ${email || phone}`);
  return true;
};

/**
 * Verify standard email OTP (unchanged)
 */
const verifyOtp = async (email, purpose, otp) => {
  const emailLower = email.toLowerCase().trim();
  const otpRecord = await Otp.findOne({
    email: emailLower,
    purpose,
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    const error = new Error('OTP not found. Please request a new OTP.');
    error.statusCode = 404;
    throw error;
  }
  if (otpRecord.expiresAt < new Date()) {
    const error = new Error('OTP has expired. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }
  if (otpRecord.attempts >= 5) {
    const error = new Error('Too many incorrect attempts. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  otpRecord.attempts += 1;
  if (otpRecord.otp !== otp) {
    await otpRecord.save();
    const remaining = 5 - otpRecord.attempts;
    const error = new Error(`Invalid OTP. You have ${remaining} attempts remaining.`);
    error.statusCode = 400;
    throw error;
  }

  otpRecord.verified = true;
  await otpRecord.save();
  logger.info(`OTP verified successfully for ${emailLower} (${purpose})`);
  return true;
};

module.exports = {
  createOtp,
  verifyOtp,
  createOtpUnified,
  verifyOtpUnified,
  sendOtpEmail,
};
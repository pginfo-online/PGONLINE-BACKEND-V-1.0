const crypto = require('crypto');
const { Resend } = require('resend');
const Otp = require('../models/Otp.model');
const { logger } = require('../utils/logger');

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Create and send OTP to user email
 * @param {string} email
 * @param {string} purpose - 'register' | 'login'
 */
const createOtp = async (email, purpose) => {
  const emailLower = email.toLowerCase().trim();

  // 1. Throttling: Must wait at least 60 seconds since last OTP request
  const latestOtp = await Otp.findOne({ email: emailLower, purpose }).sort({ createdAt: -1 });
  if (latestOtp && (Date.now() - latestOtp.createdAt.getTime() < 60000)) {
    const remainingSeconds = Math.ceil((60000 - (Date.now() - latestOtp.createdAt.getTime())) / 1000);
    const error = new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP`);
    error.statusCode = 429;
    throw error;
  }

  // 2. Abuse Prevention: Max 5 OTP requests per email in last 15 minutes
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

  // 3. Generate and save the OTP
  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // Expires in 5 minutes

  await Otp.create({
    email: emailLower,
    otp: otpCode,
    purpose,
    expiresAt,
  });

  // 4. Send Email via Resend
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const subject = purpose === 'register' 
    ? 'Verify your email - PGinfo.online' 
    : 'Your Login OTP - PGinfo.online';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #4f46e5; text-align: center; margin-bottom: 5px;">PGinfo.online</h2>
      <p style="text-align: center; color: #6b7280; font-size: 14px; margin-top: 0;">Find your perfect PG, no brokerage</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p>Hello,</p>
      <p>You requested a One-Time Password (OTP) for ${purpose === 'register' ? 'creating your account' : 'signing in'} on PGinfo.online.</p>
      <div style="background-color: #f3f4f6; padding: 18px; border-radius: 8px; text-align: center; margin: 25px 0;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #4f46e5;">${otpCode}</span>
      </div>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">This code is valid for <strong>5 minutes</strong>. If you did not request this code, please ignore this email or contact support if you have concerns.</p>
      <p style="color: #ef4444; font-size: 12px; font-weight: bold; margin-top: 15px;">⚠️ For security reasons, do not share this OTP with anyone.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px; margin-bottom: 20px;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">This is an automated message. Please do not reply directly to this email.<br>© 2026 PGinfo.online. All rights reserved.</p>
    </div>
  `;

  if (!process.env.RESEND_API_KEY) {
    logger.warn('⚠️ RESEND_API_KEY is not defined in environment variables.');
    // Simulated developer mode fallback
    if (process.env.NODE_ENV === 'developement' || process.env.NODE_ENV === 'development') {
      logger.info(`[DEV FALLBACK] Generated OTP for ${emailLower}: ${otpCode}`);
      return { success: true, message: 'OTP generated (Dev fallback log)' };
    }
    const error = new Error('Email service configuration missing. Contact administrator.');
    error.statusCode = 500;
    throw error;
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `PGinfo.online <${fromEmail}>`,
      to: emailLower,
      subject,
      html,
    });
    logger.info(`✅ OTP email sent successfully to ${emailLower} for ${purpose}`);
    return { success: true };
  } catch (sendError) {
    logger.error(`❌ Failed to send OTP email via Resend to ${emailLower}: ${sendError.message}`);
    const error = new Error('Failed to send verification email. Please try again.');
    error.statusCode = 500;
    throw error;
  }
};

/**
 * Verify OTP code
 * @param {string} email
 * @param {string} purpose - 'register' | 'login'
 * @param {string} otp
 */
const verifyOtp = async (email, purpose, otp) => {
  const emailLower = email.toLowerCase().trim();

  // Find latest OTP for this email and purpose
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

  // Check if OTP is expired
  if (otpRecord.expiresAt < new Date()) {
    const error = new Error('OTP has expired. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // Brute force protection: Check attempt count
  if (otpRecord.attempts >= 5) {
    const error = new Error('Too many incorrect attempts. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // Increment attempts
  otpRecord.attempts += 1;
  await otpRecord.save();

  // Compare OTP
  if (otpRecord.otp !== otp) {
    const remaining = 5 - otpRecord.attempts;
    const error = new Error(`Invalid OTP. You have ${remaining} attempts remaining.`);
    error.statusCode = 400;
    throw error;
  }

  // Success: mark as verified to prevent reuse (replay attack prevention)
  otpRecord.verified = true;
  await otpRecord.save();

  logger.info(`✅ OTP verified successfully for ${emailLower} (${purpose})`);
  return true;
};

module.exports = {
  createOtp,
  verifyOtp,
};

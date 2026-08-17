'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const otpService = require('../services/otp.service');
const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────────────────────────────────────
// Standard password-based auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/auth/register
 * @access Public
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  const result = await authService.registerUser({ name, email, phone, password, role });
  successResponse(res, 'Registration successful', result, 201);
});

/**
 * @route  POST /api/v1/auth/login
 * @access Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginUser({ email, password });
  successResponse(res, 'Login successful', result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated user profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/auth/me
 * @access Private
 */
const getMe = asyncHandler(async (req, res) => {
  successResponse(res, 'User profile retrieved', { user: req.user });
});

/**
 * @route  PUT /api/v1/auth/me
 * @access Private
 */
const updateMe = asyncHandler(async (req, res) => {
  const {
    name,
    phone,
    email,
    altPhone,
    gender,
    dob,
    address,
    city,
    state,
    pincode,
    profilePhoto,
    pushToken,
  } = req.body;

  const User = require('../models/User.model');

  // Format dob string to Date object if provided
  let formattedDob = undefined;
  if (dob !== undefined) {
    formattedDob = dob ? new Date(dob) : null;
  }

  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (phone !== undefined) updateFields.phone = phone;
  if (email !== undefined) updateFields.email = email ? email.toLowerCase().trim() : null;
  if (altPhone !== undefined) updateFields.altPhone = altPhone || null;
  if (gender !== undefined) updateFields.gender = gender || null;
  if (formattedDob !== undefined) updateFields.dob = formattedDob;
  if (address !== undefined) updateFields.address = address || null;
  if (city !== undefined) updateFields.city = city || null;
  if (state !== undefined) updateFields.state = state || null;
  if (pincode !== undefined) updateFields.pincode = pincode || null;
  if (profilePhoto !== undefined) updateFields.profilePhoto = profilePhoto || null;
  if (pushToken !== undefined) updateFields.pushToken = pushToken;

  // Check unique constraints on email & phone manually to return nice errors
  if (updateFields.email) {
    const existing = await User.findOne({ email: updateFields.email, _id: { $ne: req.user._id } });
    if (existing) {
      throw Object.assign(new Error('A user with this email address already exists'), { statusCode: 409 });
    }
  }
  if (updateFields.phone) {
    const existing = await User.findOne({ phone: updateFields.phone, _id: { $ne: req.user._id } });
    if (existing) {
      throw Object.assign(new Error('A user with this phone number already exists'), { statusCode: 409 });
    }
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updateFields,
    { new: true, runValidators: true }
  ).select('-password');

  successResponse(res, 'Profile updated', { user });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy email-only OTP routes (kept for backwards compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/auth/otp/send
 * @access Public
 * @desc   Send OTP for email-only register/login
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { email, purpose } = req.body;
  const emailLower = email.toLowerCase().trim();

  if (purpose === 'register') {
    const User = require('../models/User.model');
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser) {
      throw Object.assign(new Error('User with this email already exists'), { statusCode: 409 });
    }
  } else if (purpose === 'login') {
    const User = require('../models/User.model');
    const user = await User.findOne({ email: emailLower });
    if (!user) {
      throw Object.assign(
        new Error('No account found with this email. Please register first.'),
        { statusCode: 404 }
      );
    }
    if (!user.isActive) {
      throw Object.assign(
        new Error('Your account has been suspended. Contact support.'),
        { statusCode: 403 }
      );
    }
  }

  await otpService.createOtp(emailLower, purpose);
  successResponse(res, 'Verification OTP sent to email');
});

/**
 * @route  POST /api/v1/auth/otp/register
 * @access Public
 */
const verifyOtpRegister = asyncHandler(async (req, res) => {
  const { name, email, phone, otp } = req.body;
  const emailLower = email.toLowerCase().trim();
  await otpService.verifyOtp(emailLower, 'register', otp);
  const result = await authService.registerUserViaOtp({ name, email: emailLower, phone });
  successResponse(res, 'Registration successful', result, 201);
});

/**
 * @route  POST /api/v1/auth/otp/login
 * @access Public
 */
const verifyOtpLogin = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const emailLower = email.toLowerCase().trim();
  await otpService.verifyOtp(emailLower, 'login', otp);
  const result = await authService.loginUserViaOtp({ email: emailLower });
  successResponse(res, 'Login successful', result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Unified OTP flow — supports email OR phone + WhatsApp option
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/auth/otp/send-unified
 * @access Public
 * @desc   Send OTP for login OR register (doesn't pre-check user existence).
 *         When contact is a phone number:
 *           - Always sends SMS (Ping4SMS route=4)
 *           - Also sends WhatsApp (Ping4SMS route=6) if sendWhatsApp=true (default)
 */
const sendOtpUnified = asyncHandler(async (req, res) => {
  const { contact, type, sendWhatsApp = true } = req.body;

  const emailNorm = type === 'email' ? contact.toLowerCase().trim() : undefined;
  const phoneNorm = type === 'phone' ? contact.trim() : undefined;

  const result = await otpService.createOtpUnified({
    email: emailNorm,
    phone: phoneNorm,
    sendWhatsApp: Boolean(sendWhatsApp),
  });

  // Build a helpful message describing which channels were used
  const channelLabels = {
    email: 'email',
    sms: 'SMS',
    whatsapp: 'WhatsApp',
  };
  const channelList = (result.channels || [])
    .map((c) => channelLabels[c] || c)
    .join(' & ');

  successResponse(
    res,
    `Verification OTP sent via ${channelList || 'selected channel'}`,
    { channels: result.channels }
  );
});

/**
 * @route  POST /api/v1/auth/otp/verify-unified
 * @access Public
 * @desc   Verify OTP.
 *         - Existing user  → log in, return { user, token }
 *         - New user + isMobile=true  → auto-register (tenant, auto-name) + log in, no second trip
 *         - New user + isMobile=false → return tempToken for web registration form
 */
const verifyOtpUnified = asyncHandler(async (req, res) => {
  const { contact, otp, isMobile = false } = req.body;

  const isEmail = /\S+@\S+\.\S+/.test(contact);
  const emailNorm = isEmail ? contact.toLowerCase().trim() : undefined;
  const phoneNorm = !isEmail ? contact.trim() : undefined;

  // Verify OTP (throws on failure with attempt count in message)
  await otpService.verifyOtpUnified({ email: emailNorm, phone: phoneNorm, otp });

  // Look up user
  const User = require('../models/User.model');
  let user = null;
  if (emailNorm) {
    user = await User.findOne({ email: emailNorm });
  } else {
    user = await User.findOne({ phone: phoneNorm });
  }

  // ── Token duration: 90 days for mobile, 7 days for web ────────────────────
  const tokenExpiry = isMobile ? '90d' : (process.env.JWT_EXPIRES_IN || '7d');
  const generateTokenWithExpiry = (userId) =>
    jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: tokenExpiry });

  if (user) {
    // ── Existing user → log in ────────────────────────────────────────────
    if (!user.isActive) {
      throw Object.assign(
        new Error('Your account has been suspended. Please contact support.'),
        { statusCode: 403 }
      );
    }

    user.lastLogin = new Date();
    if (emailNorm && !user.emailVerified) user.emailVerified = true;
    if (phoneNorm && !user.phoneVerified) user.phoneVerified = true;
    await user.save({ validateBeforeSave: false });

    const token = generateTokenWithExpiry(user._id);
    return successResponse(res, 'Login successful', {
      isNewUser: false,
      user: user.toSafeObject(),
      token,
    });
  }

  // ── New user ────────────────────────────────────────────────────────────────
  if (isMobile) {
    // Mobile: auto-register instantly (tenant, auto-name) — zero extra steps
    const result = await authService.registerUserViaOtp({ phone: phoneNorm });
    const token = generateTokenWithExpiry(result.user._id || result.user.id);
    return successResponse(res, 'Welcome to PGinfo! Account created.', {
      isNewUser: true,
      user: result.user,
      token,
    });
  }

  // Web: issue a short-lived registration token for the name/role form
  const tempToken = jwt.sign(
    { email: emailNorm, phone: phoneNorm, type: 'registration' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  return successResponse(res, 'New user — proceed to registration', {
    isNewUser: true,
    tempToken,
  });
});

/**
 * @route  POST /api/v1/auth/register-complete
 * @access Public
 * @desc   Finalise registration for a new user after OTP verification
 */
const registerComplete = asyncHandler(async (req, res) => {
  const { tempToken, name, phone: newPhone } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(
      new Error('Invalid or expired session. Please start again.'),
      { statusCode: 400 }
    );
  }

  if (decoded.type !== 'registration') {
    throw Object.assign(new Error('Invalid token type'), { statusCode: 400 });
  }

  const emailFromToken = decoded.email || null;
  const phoneFromToken = decoded.phone || newPhone || null;

  const result = await authService.registerUserViaOtp({
    name,
    email: emailFromToken,
    phone: phoneFromToken,
  });

  successResponse(res, 'Registration successful', result, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  register,
  login,
  getMe,
  updateMe,
  sendOtp,
  verifyOtpRegister,
  verifyOtpLogin,
  sendOtpUnified,
  verifyOtpUnified,
  registerComplete,
};

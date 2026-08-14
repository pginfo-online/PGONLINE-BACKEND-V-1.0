'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User.model');

// ─────────────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a signed JWT for a user
 * @param {string} userId
 * @returns {string} signed JWT
 */
const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Standard password-based auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a new user with email + password
 * @param {{ name, email, phone?, password, role? }}
 */
const registerUser = async ({ name, email, phone, password, role }) => {
  const emailLower = email.toLowerCase().trim();
  const existing = await User.findOne({ email: emailLower });
  if (existing) {
    throw Object.assign(new Error('User with this email already exists'), {
      statusCode: 409,
    });
  }

  const user = await User.create({ name, email: emailLower, phone, password, role });
  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Log in a user with email + password
 * @param {{ email, password }}
 */
const loginUser = async ({ email, password }) => {
  const emailLower = email.toLowerCase().trim();
  const user = await User.findOne({ email: emailLower }).select('+password');

  if (!user) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }
  if (!user.isActive) {
    throw Object.assign(
      new Error('Your account has been suspended. Contact support.'),
      { statusCode: 403 }
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

// ─────────────────────────────────────────────────────────────────────────────
// OTP-based auth helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a new user after email OTP verification.
 * Supports email-only, phone-only, or email+phone combinations.
 *
 * @param {{ name: string, email?: string|null, phone?: string }}
 */
const registerUserViaOtp = async ({ name, email, phone }) => {
  const emailNorm = email ? email.toLowerCase().trim() : null;
  const phoneNorm = phone ? phone.trim() : null;

  // Duplicate-check
  if (emailNorm) {
    const existingByEmail = await User.findOne({ email: emailNorm });
    if (existingByEmail) {
      throw Object.assign(new Error('User with this email already exists'), {
        statusCode: 409,
      });
    }
  }
  if (phoneNorm) {
    const existingByPhone = await User.findOne({ phone: phoneNorm });
    if (existingByPhone) {
      // If phone already linked → just log them in
      const token = generateToken(existingByPhone._id);
      existingByPhone.lastLogin = new Date();
      await existingByPhone.save({ validateBeforeSave: false });
      return { user: existingByPhone.toSafeObject(), token };
    }
  }

  // Generate a high-entropy random password (OTP users don't need a password)
  const randomPassword = crypto.randomBytes(20).toString('hex');

  const user = await User.create({
    name,
    email: emailNorm || undefined,
    phone: phoneNorm || undefined,
    password: randomPassword,
    role: 'tenant',               // OTP registration always starts as tenant
    emailVerified: !!emailNorm,   // email OTP → email is verified
    phoneVerified: !!phoneNorm,   // phone OTP → phone is verified
  });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Log in an existing user by email (after OTP verification)
 * @param {{ email: string }}
 */
const loginUserViaOtp = async ({ email }) => {
  const emailLower = email.toLowerCase().trim();
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

  user.lastLogin = new Date();
  if (!user.emailVerified) user.emailVerified = true;
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Log in an existing user by phone (after OTP verification)
 * @param {{ phone: string }}
 */
const loginUserViaPhone = async ({ phone }) => {
  const phoneNorm = phone.trim();
  const user = await User.findOne({ phone: phoneNorm });

  if (!user) {
    throw Object.assign(
      new Error('No account found with this number. Please register first.'),
      { statusCode: 404 }
    );
  }
  if (!user.isActive) {
    throw Object.assign(
      new Error('Your account has been suspended. Contact support.'),
      { statusCode: 403 }
    );
  }

  user.lastLogin = new Date();
  if (!user.phoneVerified) user.phoneVerified = true;
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Update user push notification token
 * @param {string} userId
 * @param {string} pushToken
 */
const updatePushToken = async (userId, pushToken) =>
  User.findByIdAndUpdate(userId, { pushToken }, { new: true }).select('-password');

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateToken,
  registerUser,
  loginUser,
  updatePushToken,
  registerUserViaOtp,
  loginUserViaOtp,
  loginUserViaPhone,
};

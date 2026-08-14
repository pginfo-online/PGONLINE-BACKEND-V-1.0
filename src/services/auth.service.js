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
  const emailLower = email ? email.toLowerCase().trim() : null;
  const phoneNorm = phone ? phone.trim() : null;

  if (emailLower) {
    const existing = await User.findOne({ email: emailLower });
    if (existing) {
      throw Object.assign(new Error('User with this email already exists'), {
        statusCode: 409,
      });
    }
  }

  if (phoneNorm) {
    const existingPhone = await User.findOne({ phone: phoneNorm });
    if (existingPhone) {
      throw Object.assign(new Error('User with this mobile number already exists'), {
        statusCode: 409,
      });
    }
  }

  const user = await User.create({
    name,
    email: emailLower || undefined,
    phone: phoneNorm || undefined,
    password,
    role: role || 'tenant',
  });
  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Log in a user with email OR phone number + password
 * @param {{ email: string, password: string }}
 */
const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw Object.assign(new Error('Email/Mobile and password are required'), { statusCode: 400 });
  }

  const identifier = email.trim();
  const isEmail = /\S+@\S+\.\S+/.test(identifier);
  const digits = identifier.replace(/\D/g, '');
  const isPhone = digits.length >= 10 && /^[6-9]\d{9}$/.test(digits.slice(-10));

  let query;
  if (isEmail) {
    query = { email: identifier.toLowerCase() };
  } else if (isPhone) {
    const phone10 = digits.slice(-10);
    query = { $or: [{ phone: phone10 }, { phone: identifier }] };
  } else {
    query = {
      $or: [
        { email: identifier.toLowerCase() },
        { phone: identifier },
        ...(digits.length >= 10 ? [{ phone: digits.slice(-10) }] : []),
      ],
    };
  }

  const user = await User.findOne(query).select('+password');

  if (!user) {
    throw Object.assign(new Error('Invalid email/mobile or password'), { statusCode: 401 });
  }
  if (!user.isActive) {
    throw Object.assign(
      new Error('Your account has been suspended. Contact support.'),
      { statusCode: 403 }
    );
  }

  if (!user.password) {
    throw Object.assign(
      new Error('This account was created via OTP. Please log in using OTP.'),
      { statusCode: 400 }
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw Object.assign(new Error('Invalid email/mobile or password'), { statusCode: 401 });
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
 * Register a new user after OTP verification.
 * Supports phone-only (mobile), email-only, or email+phone combinations.
 * For mobile: name is auto-generated from phone number when not supplied.
 *
 * @param {{ name?: string, email?: string|null, phone?: string }}
 */
const registerUserViaOtp = async ({ name, email, phone }) => {
  const emailNorm = email ? email.toLowerCase().trim() : null;
  const phoneNorm = phone ? phone.trim() : null;

  // ── Duplicate-check (strictly guarded — no null queries) ──────────────────
  if (emailNorm) {
    const existingByEmail = await User.findOne({ email: emailNorm });
    if (existingByEmail) {
      // Email already used → just log them in
      const token = generateToken(existingByEmail._id);
      existingByEmail.lastLogin = new Date();
      if (!existingByEmail.emailVerified) existingByEmail.emailVerified = true;
      await existingByEmail.save({ validateBeforeSave: false });
      return { user: existingByEmail.toSafeObject(), token };
    }
  }

  if (phoneNorm) {
    const existingByPhone = await User.findOne({ phone: phoneNorm });
    if (existingByPhone) {
      // Phone already linked → just log them in
      const token = generateToken(existingByPhone._id);
      existingByPhone.lastLogin = new Date();
      if (!existingByPhone.phoneVerified) existingByPhone.phoneVerified = true;
      await existingByPhone.save({ validateBeforeSave: false });
      return { user: existingByPhone.toSafeObject(), token };
    }
  }

  // ── Auto-generate name for phone-only mobile registrations ────────────────
  // The User model requires `name`. For phone-only users, use last 4 digits
  // as a placeholder. Users can update it from their profile screen later.
  const resolvedName = name && name.trim().length >= 2
    ? name.trim()
    : phoneNorm
      ? `User${phoneNorm.slice(-4)}`
      : 'PGinfo User';

  // Generate a high-entropy random password (OTP users don't need a real password)
  const randomPassword = crypto.randomBytes(20).toString('hex');

  const user = await User.create({
    name: resolvedName,
    email: emailNorm || undefined,
    phone: phoneNorm || undefined,
    password: randomPassword,
    role: 'tenant',             // OTP registrations always start as tenant
    emailVerified: !!emailNorm, // email OTP → email is verified
    phoneVerified: !!phoneNorm, // phone OTP → phone is verified
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

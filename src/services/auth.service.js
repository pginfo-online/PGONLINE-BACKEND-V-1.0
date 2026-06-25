const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User.model');

/**
 * Generate JWT token for a user
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Register a new user (tenant or owner)
 */
const registerUser = async ({ name, email, phone, password, role }) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const error = new Error('User with this email already exists');
    error.statusCode = 409;
    throw error;
  }

  const user = await User.create({ name, email, phone, password, role });
  const token = generateToken(user._id);

  return { user: user.toSafeObject(), token };
};

/**
 * Login a user
 */
const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Your account has been suspended. Contact support.');
    error.statusCode = 403;
    throw error;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Update user push token (for notifications)
 */
const updatePushToken = async (userId, pushToken) => {
  return User.findByIdAndUpdate(userId, { pushToken }, { new: true }).select('-password');
};

/**
 * Register a user who verified their email via OTP
 */
const registerUserViaOtp = async ({ name, email, phone }) => {
  const emailLower = email.toLowerCase().trim();
  const existingUser = await User.findOne({ email: emailLower });
  if (existingUser) {
    const error = new Error('User with this email already exists');
    error.statusCode = 409;
    throw error;
  }

  // Generate a random high-entropy password because the password field is required in the DB schema
  const randomPassword = crypto.randomBytes(20).toString('hex');
  const user = await User.create({
    name,
    email: emailLower,
    phone: phone || undefined,
    password: randomPassword,
    role: 'tenant', // OTP registration defaults to tenant role
  });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

/**
 * Login a user who verified their email via OTP
 */
const loginUserViaOtp = async ({ email }) => {
  const emailLower = email.toLowerCase().trim();
  const user = await User.findOne({ email: emailLower });

  if (!user) {
    const error = new Error('No account found with this email. Please register first.');
    error.statusCode = 404;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Your account has been suspended. Contact support.');
    error.statusCode = 403;
    throw error;
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);
  return { user: user.toSafeObject(), token };
};

module.exports = {
  generateToken,
  registerUser,
  loginUser,
  updatePushToken,
  registerUserViaOtp,
  loginUserViaOtp,
};

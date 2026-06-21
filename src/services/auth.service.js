const jwt = require('jsonwebtoken');
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

module.exports = { generateToken, registerUser, loginUser, updatePushToken };

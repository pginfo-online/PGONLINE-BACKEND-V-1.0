const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const otpService = require('../services/otp.service');

/**
 * @route POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  const result = await authService.registerUser({ name, email, phone, password, role });
  successResponse(res, 'Registration successful', result, 201);
});

/**
 * @route POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginUser({ email, password });
  successResponse(res, 'Login successful', result);
});

/**
 * @route GET /api/v1/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  successResponse(res, 'User profile retrieved', { user: req.user });
});

/**
 * @route PUT /api/v1/auth/me
 */
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone, pushToken } = req.body;
  const User = require('../models/User.model');
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { name, phone, pushToken },
    { new: true, runValidators: true }
  ).select('-password');
  successResponse(res, 'Profile updated', { user });
});

/**
 * @route POST /api/v1/auth/otp/send
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { email, purpose } = req.body;
  const emailLower = email.toLowerCase().trim();

  // Safety checks
  if (purpose === 'register') {
    const User = require('../models/User.model');
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }
  } else if (purpose === 'login') {
    const User = require('../models/User.model');
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
  }

  await otpService.createOtp(emailLower, purpose);
  successResponse(res, 'Verification OTP sent to email');
});

/**
 * @route POST /api/v1/auth/otp/register
 */
const verifyOtpRegister = asyncHandler(async (req, res) => {
  const { name, email, phone, otp } = req.body;
  const emailLower = email.toLowerCase().trim();

  // Verify OTP
  await otpService.verifyOtp(emailLower, 'register', otp);

  // Register User
  const result = await authService.registerUserViaOtp({ name, email: emailLower, phone });
  successResponse(res, 'Registration successful', result, 201);
});

/**
 * @route POST /api/v1/auth/otp/login
 */
const verifyOtpLogin = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const emailLower = email.toLowerCase().trim();

  // Verify OTP
  await otpService.verifyOtp(emailLower, 'login', otp);

  // Log in User
  const result = await authService.loginUserViaOtp({ email: emailLower });
  successResponse(res, 'Login successful', result);
});

module.exports = {
  register,
  login,
  getMe,
  updateMe,
  sendOtp,
  verifyOtpRegister,
  verifyOtpLogin,
};

const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const otpService = require('../services/otp.service');
const jwt = require('jsonwebtoken');   // <-- added

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



// ... at the end of the existing controller file, add:

/**
 * @route POST /api/v1/auth/otp/send-unified
 * @desc  Send OTP for login OR register (doesn't check existence)
 */
const sendOtpUnified = asyncHandler(async (req, res) => {
  const { contact, type } = req.body;
  // contact can be email or phone (phone includes country code validation later)
  const email = type === 'email' ? contact.toLowerCase().trim() : undefined;
  const phone = type === 'phone' ? contact.trim() : undefined;

  // We'll create a generic OTP with purpose 'unified'
  await otpService.createOtpUnified({ email, phone });
  successResponse(res, 'Verification OTP sent');
});

/**
 * @route POST /api/v1/auth/otp/verify-unified
 * @desc  Verify OTP. If user exists → login; else → return temp token for registration
 */
const verifyOtpUnified = asyncHandler(async (req, res) => {
  const { contact, otp } = req.body;
  // Detect type (simple, can be improved)
  const isEmail = /\S+@\S+\.\S+/.test(contact);
  const email = isEmail ? contact.toLowerCase().trim() : undefined;
  const phone = !isEmail ? contact.trim() : undefined;

  // Verify OTP (this method returns true or throws)
  await otpService.verifyOtpUnified({ email, phone, otp });

  // Check if user exists
  const User = require('../models/User.model');
  let user = null;
  if (email) {
    user = await User.findOne({ email });
  } else {
    user = await User.findOne({ phone });
  }

  if (user) {
    // Existing user → login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = authService.generateToken(user._id);
    successResponse(res, 'Login successful', { isNewUser: false, user: user.toSafeObject(), token });
  } else {
    // New user → create a temporary token that allows registration
    const tempToken = jwt.sign(
      { email, phone, type: 'registration' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    successResponse(res, 'New user - proceed to registration', { isNewUser: true, tempToken });
  }
});

/**
 * @route POST /api/v1/auth/register-complete
 * @desc  Finalise registration after OTP verification for a new user
 */
const registerComplete = asyncHandler(async (req, res) => {
  const { tempToken, name, phone: newPhone } = req.body;

  // Verify temp token
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    const error = new Error('Invalid or expired session. Please start again.');
    error.statusCode = 400;
    throw error;
  }

  if (decoded.type !== 'registration') {
    const error = new Error('Invalid token type');
    error.statusCode = 400;
    throw error;
  }

  const email = decoded.email || undefined;
  const phoneFromToken = decoded.phone || undefined;

  // Register user (reuse existing service)
  const result = await authService.registerUserViaOtp({
    name,
    email: email || null,
    phone: phoneFromToken || newPhone || undefined,
  });

  successResponse(res, 'Registration successful', result, 201);
});

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

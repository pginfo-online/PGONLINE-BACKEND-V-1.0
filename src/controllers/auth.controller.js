const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const authService = require('../services/auth.service');

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

module.exports = { register, login, getMe, updateMe };

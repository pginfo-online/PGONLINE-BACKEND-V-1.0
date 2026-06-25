const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateMe,
  sendOtp, verifyOtpRegister, verifyOtpLogin,
} = require('../../controllers/auth.controller');
const { protect } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  sendOtpSchema,
  verifyOtpRegisterSchema,
  verifyOtpLoginSchema,
} = require('../../validators/auth.validator');

// ─── Standard Auth Routes (unchanged) ────────────────────────────────────────
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', protect, getMe);
router.put('/me', protect, validate(updateProfileSchema), updateMe);

// ─── OTP Auth Routes (Mobile Tenant Users Only) ───────────────────────────────
router.post('/otp/send', validate(sendOtpSchema), sendOtp);
router.post('/otp/register', validate(verifyOtpRegisterSchema), verifyOtpRegister);
router.post('/otp/login', validate(verifyOtpLoginSchema), verifyOtpLogin);

module.exports = router;

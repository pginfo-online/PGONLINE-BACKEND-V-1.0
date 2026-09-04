const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateMe,
  sendOtp, verifyOtpRegister, verifyOtpLogin, sendOtpUnified, verifyOtpUnified, registerComplete
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
  sendOtpUnifiedSchema,
  verifyOtpUnifiedSchema,
  registerCompleteSchema
} = require('../../validators/auth.validator');

const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Standard Auth Routes (unchanged) ────────────────────────────────────────
router.post('/register', validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', protect, getMe);
router.put('/me', protect, validate(updateProfileSchema), updateMe);


// ... existing routes
router.post('/otp/send-unified', validate(sendOtpUnifiedSchema), sendOtpUnified);
router.post('/otp/verify-unified', validate(verifyOtpUnifiedSchema), verifyOtpUnified);
router.post('/register-complete', validate(registerCompleteSchema), registerComplete);



// ─── OTP Auth Routes (Mobile Tenant Users Only) ───────────────────────────────
router.post('/otp/send', validate(sendOtpSchema), sendOtp);
router.post('/otp/register', validate(verifyOtpRegisterSchema), verifyOtpRegister);
router.post('/otp/login', validate(verifyOtpLoginSchema), verifyOtpLogin);

module.exports = router;

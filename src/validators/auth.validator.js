const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
    .optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['tenant', 'owner']).default('tenant'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
  pushToken: z.string().optional(),
});

const sendOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  purpose: z.enum(['register', 'login'], {
    errorMap: () => ({ message: "Purpose must be 'register' or 'login'" }),
  }),
});

const verifyOtpRegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
    .optional()
    .or(z.literal('')), // allow empty string or optional
});

const verifyOtpLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits'),
});

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  sendOtpSchema,
  verifyOtpRegisterSchema,
  verifyOtpLoginSchema,
};

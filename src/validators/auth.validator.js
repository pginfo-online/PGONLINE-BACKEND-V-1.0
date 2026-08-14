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
  email: z.string().min(1, 'Email or mobile number is required'),
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
  otp: z.string().regex(/^[0-9]{4}$/, 'OTP must be exactly 4 digits'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
    .optional()
    .or(z.literal('')), // allow empty string or optional
});

const verifyOtpLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().regex(/^[0-9]{4}$/, 'OTP must be exactly 4 digits'),
});

const createOwnerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
    .optional()
    .or(z.literal('')), // allow empty string or optional
  password: z.string().min(6, 'Password must be at least 6 characters'),
});


const sendOtpUnifiedSchema = z.object({
  contact: z.string().min(3, 'Contact must be at least 3 characters'),
  type: z.enum(['email', 'phone'], {
    errorMap: () => ({ message: "Type must be 'email' or 'phone'" }),
  }),
  /**
   * When true (default), also deliver the OTP via WhatsApp for phone contacts.
   * Has no effect when contact type is 'email'.
   */
  sendWhatsApp: z.boolean().optional().default(true),
});

const verifyOtpUnifiedSchema = z.object({
  contact: z.string().min(3),
  otp: z.string().length(4, 'OTP must be exactly 4 digits'),
  // When true, issues a 90-day JWT and auto-registers new users without a second round trip
  isMobile: z.boolean().optional().default(false),
});

const registerCompleteSchema = z.object({
  tempToken: z.string(),
  name: z.string().min(2).max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional().or(z.literal('')),
});

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  sendOtpSchema,
  verifyOtpRegisterSchema,
  verifyOtpLoginSchema,
  createOwnerSchema,
  sendOtpUnifiedSchema,
  verifyOtpUnifiedSchema,
  registerCompleteSchema,
};

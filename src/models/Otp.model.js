const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },

    phone: {
      type: String,
      trim: true,
    },

    otp: {
      type: String,
      required: [true, 'OTP is required'],
    },

    purpose: {
      type: String,
      enum: ['register', 'login', 'unified'],
      required: [true, 'OTP purpose is required'],
    },

    attempts: {
      type: Number,
      default: 0,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Automatically delete OTP documents 1 hour after creation
otpSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 3600 }
);

// Useful for finding OTPs
otpSchema.index({
  email: 1,
  purpose: 1,
});

otpSchema.index({
  phone: 1,
  purpose: 1,
});

module.exports = mongoose.model('Otp', otpSchema);
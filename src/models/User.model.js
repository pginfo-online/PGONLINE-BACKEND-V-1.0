const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    // ─── Contact fields (at least one required — enforced via pre-validate hook) ──
    email: {
      type: String,
      unique: true,
      sparse: true,           // allows multiple null values (phone-only users)
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    phone: {
      type: String,
      unique: true,
      sparse: true,           // allows multiple null values (email-only users)
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number'],
    },

    // ─── Verification status ──────────────────────────────────────────────────
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },

    // ─── Auth ─────────────────────────────────────────────────────────────────
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },

    // ─── Role-Based Access Control ─────────────────────────────────────────────
    role: {
      type: String,
      enum: ['admin', 'owner', 'tenant', 'staff', 'property_manager'],
      default: 'tenant',
    },

    // ─── Account state ────────────────────────────────────────────────────────
    isActive: {
      type: Boolean,
      default: true,
    },

    // ─── Notification ─────────────────────────────────────────────────────────
    pushToken: {
      type: String,
      default: null,
    },

    // ─── Profile ──────────────────────────────────────────────────────────────
    profilePhoto: {
      type: String,
      default: null,
    },
    altPhone: {
      type: String,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number'],
      default: null,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
      default: null,
    },
    dob: {
      type: Date,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },
    pincode: {
      type: String,
      trim: true,
      match: [/^\d{6}$/, 'Please enter a valid 6-digit Indian pincode'],
      default: null,
    },

    // ─── Activity ─────────────────────────────────────────────────────────────
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Validation: at least email OR phone must be present ─────────────────────
userSchema.pre('validate', function (next) {
  if (!this.email && !this.phone) {
    return next(new Error('User must have at least an email or phone number'));
  }
  next();
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

// ─── Pre-save Hook: Hash password ─────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ─── Instance Method: Compare password ────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Instance Method: Sanitized output (strips password) ──────────────────────
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// ─── Virtual: Primary identifier (email preferred, phone fallback) ────────────
userSchema.virtual('primaryIdentifier').get(function () {
  return this.email || this.phone;
});

module.exports = mongoose.model('User', userSchema);

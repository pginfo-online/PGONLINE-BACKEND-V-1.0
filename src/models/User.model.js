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

    // Contact fields (at least one required -- enforced via pre-validate hook)
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number'],
    },

    // Verification status
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    // Auth
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },

    // ---- Multi-Role System -----------------------------------------------
    // A user can have multiple roles simultaneously.
    // Valid roles: admin | owner | tenant | staff | property_manager |
    //              hotel_owner | pg_owner | meetup_organizer | hot_deals_partner
    roles: {
      type: [String],
      enum: [
        'admin',
        'owner',
        'tenant',
        'staff',
        'property_manager',
        'hotel_owner',
        'pg_owner',
        'meetup_organizer',
        'hot_deals_partner',
      ],
      default: undefined,
    },

    // Legacy single role field (backward-compat)
    role: {
      type: String,
      enum: ['admin', 'owner', 'tenant', 'staff', 'property_manager', 'hotel_owner'],
      default: 'tenant',
    },

    // Hotel Owner flag (legacy -- auto-synced with roles array)
    isHotelOwner: { type: Boolean, default: false },

    // Account state
    isActive: { type: Boolean, default: true },

    // Push notification token
    pushToken: { type: String, default: null },

    // Profile
    profilePhoto: { type: String, default: null },
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
    dob: { type: Date, default: null },
    address: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    state: { type: String, trim: true, default: null },
    pincode: {
      type: String,
      trim: true,
      match: [/^\d{6}$/, 'Please enter a valid 6-digit Indian pincode'],
      default: null,
    },

    // Activity
    lastLogin: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Fail-safe & Auto-healing Role Normalization
 * Ensures:
 * 1. Legacy role (admin/owner/hotel_owner) is NEVER overwritten by 'tenant'
 * 2. Primary admin email (admin@pginfo.online) is automatically given 'admin' role
 * 3. roles array and role string stay 100% in sync
 */
function normalizeUserRoles(doc) {
  if (!doc) return;
  let roles = doc.roles || [];
  if (!Array.isArray(roles)) roles = [];

  // 1. Ensure existing single role is included in roles array
  if (doc.role && !roles.includes(doc.role)) {
    roles.push(doc.role);
  }

  // 2. Ensure isHotelOwner flag is reflected in roles array
  if (doc.isHotelOwner && !roles.includes('hotel_owner')) {
    roles.push('hotel_owner');
  }

  // 3. Auto-heal primary admin account if email is admin@pginfo.online
  if (doc.email && doc.email.toLowerCase() === 'admin@pginfo.online' && !roles.includes('admin')) {
    roles.push('admin');
  }

  // 4. Remove 'tenant' if user has higher roles
  if (roles.length > 1 && roles.includes('tenant')) {
    roles = roles.filter((r) => r !== 'tenant');
  }

  // 5. Fallback to 'tenant' if completely empty
  if (roles.length === 0) {
    roles.push('tenant');
  }

  doc.roles = Array.from(new Set(roles));
  doc.isHotelOwner = doc.roles.includes('hotel_owner');

  // 6. Derive legacy role field (priority: admin > hotel_owner > owner > pg_owner > property_manager > staff > tenant)
  const ROLE_PRIORITY = ['admin', 'hotel_owner', 'owner', 'pg_owner', 'property_manager', 'staff', 'tenant'];
  for (const r of ROLE_PRIORITY) {
    if (doc.roles.includes(r)) {
      doc.role = r;
      break;
    }
  }
}

// ---- Mongoose Hooks ---------------------------------------------------------
userSchema.post('init', function (doc) {
  normalizeUserRoles(doc);
});

userSchema.pre('validate', function (next) {
  if (!this.email && !this.phone) {
    return next(new Error('User must have at least an email or phone number'));
  }
  normalizeUserRoles(this);
  next();
});

userSchema.pre('save', async function (next) {
  normalizeUserRoles(this);
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

// ---- Indexes ----------------------------------------------------------------
userSchema.index({ role: 1 });
userSchema.index({ roles: 1 });
userSchema.index({ isActive: 1 });

// ---- Instance Method: Compare password -------------------------------------
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// ---- Instance Method: Check single role ------------------------------------
userSchema.methods.hasRole = function (role) {
  normalizeUserRoles(this);
  return Array.isArray(this.roles) ? this.roles.includes(role) : this.role === role;
};

// ---- Instance Method: Check any of multiple roles --------------------------
userSchema.methods.hasAnyRole = function (...roles) {
  return roles.some((r) => this.hasRole(r));
};

// ---- Instance Method: Sanitized output (strips password) -------------------
userSchema.methods.toSafeObject = function () {
  normalizeUserRoles(this);
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// ---- Virtual: Primary identifier (email preferred, phone fallback) ----------
userSchema.virtual('primaryIdentifier').get(function () {
  return this.email || this.phone;
});

module.exports = mongoose.model('User', userSchema);

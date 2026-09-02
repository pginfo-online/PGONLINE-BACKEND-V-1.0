const mongoose = require('mongoose');

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const roomConfigSchema = new mongoose.Schema(
  {
    shareType: {
      type: String,
      enum: ['single', 'double', 'triple', 'four', 'dormitory', 'studio'],
      required: true,
    },
    rent: { type: Number, min: 0, required: true },
    depositAmount: { type: Number, min: 0 },
    totalBeds: { type: Number, min: 0, default: 0 },
    availableBeds: { type: Number, min: 0, default: 0 },
    roomSize: { type: String, trim: true },           // e.g. "12x10 ft"
    furnitureIncluded: { type: Boolean, default: false },
    acIncluded: { type: Boolean, default: false },
    bathroomType: {
      type: String,
      enum: ['attached', 'shared', 'common-floor'],
      default: 'shared',
    },
    amenities: { type: [String], default: [] },        // room-level extras
  },
  { _id: true }
);

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    caption: { type: String, trim: true },
    isMain: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const videoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    thumbnailUrl: { type: String },
    title: { type: String, trim: true, maxlength: 150 },
    duration: { type: Number },                        // seconds
    order: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const nearbyPlaceSchema = new mongoose.Schema(
  {
    placeType: {
      type: String,
      enum: [
        'college', 'metro', 'bus_stop', 'hospital', 'it_park',
        'railway_station', 'shopping_mall', 'restaurant', 'bank_atm',
        'park', 'pharmacy', 'supermarket', 'other',
      ],
    },
    name: { type: String, trim: true },
    distance: { type: Number },                        // km
    walkTime: { type: Number },                        // minutes
    placeId: { type: String, trim: true },             // Google Place ID
    address: { type: String, trim: true },
  },
  { _id: false }
);

const mealTimingSchema = new mongoose.Schema(
  {
    provided: { type: Boolean, default: true },
    from: { type: String, trim: true },                // e.g. "07:30" or "7:00 AM"
    to: { type: String, trim: true },                  // e.g. "09:30" or "9:00 AM"
  },
  { _id: false }
);

const foodInfoSchema = new mongoose.Schema(
  {
    provided: { type: Boolean, default: false },
    type: { type: String, enum: ['veg', 'nonveg', 'both'] },
    includedInRent: { type: Boolean, default: false },
    mealCostPerMonth: { type: Number, min: 0 },
    mealsPerDay: { type: Number, min: 1, max: 3 },
    mealTimings: {
      breakfast: mealTimingSchema,
      lunch: mealTimingSchema,
      dinner: mealTimingSchema,
    },
    kitchenAccess: { type: Boolean, default: false },
    kitchenHours: { type: String, trim: true },        // e.g. "6 AM – 10 PM"
    messType: {
      type: String,
      enum: ['in-house', 'outsourced', 'tiffin-service', 'self'],
    },
  },
  { _id: false }
);

const rulesSchema = new mongoose.Schema(
  {
    smokingAllowed: { type: Boolean, default: false },
    alcoholAllowed: { type: Boolean, default: false },
    petsAllowed: { type: Boolean, default: false },
    guestsAllowed: { type: Boolean, default: true },
    visitorPolicy: {
      type: String,
      enum: ['not_allowed', 'lobby_only', 'room_allowed'],
      default: 'lobby_only',
    },
    curfewTime: { type: String, trim: true },          // e.g. "10:00 PM"
    cookingAllowed: { type: Boolean, default: false },
    nonVegAllowed: { type: Boolean, default: true },   // inside room
    customRules: { type: [String], default: [] },
  },
  { _id: false }
);

// ─── Main Schema ─────────────────────────────────────────────────────────────

const pgSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Identification ────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'PG name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    propertyType: {
      type: String,
      enum: ['PG', 'Hostel', 'Co-living', 'Apartment', 'Independent House', 'Other'],
      default: 'PG',
    },
    propertyAge: { type: Number, min: 0 },

    // ── Location ──────────────────────────────────────────────────────────────
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    area: {
      type: String,
      required: [true, 'Area is required'],
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    fullAddress: { type: String, trim: true },
    landmark: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },
    postalCode: { type: String, trim: true },
    googlePlaceId: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
    mapsLink: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },

    // ── Rooms & Pricing — single source of truth ──────────────────────────────
    // NOTE: rent, totalBeds, availableBeds are now computed VIRTUALS from roomConfigs
    roomConfigs: {
      type: [roomConfigSchema],
      default: [],
      validate: {
        validator: function (v) { return v.length <= 10; },
        message: 'A PG can have at most 10 room configurations',
      },
    },
    floors: { type: Number, min: 1 },
    totalRooms: { type: Number, min: 1 },

    // ── Policies ──────────────────────────────────────────────────────────────
    securityDeposit: { type: Number, min: 0 },
    noticePeriod: { type: Number, min: 0 },            // days
    minStay: { type: Number, min: 0 },                 // months
    maxStay: { type: Number, min: 0 },                 // months
    yearlyPricing: { type: Number, min: 0 },
    monthlyPricing: { type: Number, min: 0 },

    // ── Targeting ─────────────────────────────────────────────────────────────
    gender: {
      type: String,
      enum: ['male', 'female', 'any'],
      default: 'any',
    },
    preferredTenants: {
      type: [String],
      enum: ['student', 'working_professional', 'family', 'any'],
      default: ['any'],
    },

    // ── Food & Kitchen ────────────────────────────────────────────────────────
    // Legacy quick-access fields (synced from foodInfo)
    food: { type: String, enum: ['veg', 'nonveg', 'both', 'none'], default: 'none' },
    foodIncluded: { type: Boolean, default: false },
    // Structured food information
    foodInfo: { type: foodInfoSchema, default: () => ({}) },

    // ── Amenities ─────────────────────────────────────────────────────────────
    // Free-form array — no enum constraint so facilities can evolve without migrations
    ac: { type: Boolean, default: false },
    facilities: { type: [String], default: [] },

    // ── PG Rules ──────────────────────────────────────────────────────────────
    rules: { type: rulesSchema, default: () => ({}) },

    // ── Media ─────────────────────────────────────────────────────────────────
    photos: {
      type: [photoSchema],
      default: [],
      validate: {
        validator: function (v) { return v.length <= 20; },
        message: 'A PG can have at most 20 photos',
      },
    },
    videos: {
      type: [videoSchema],
      default: [],
      validate: {
        validator: function (v) { return v.length <= 3; },
        message: 'A PG can have at most 3 videos',
      },
    },

    // ── Contact ───────────────────────────────────────────────────────────────
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
    },
    contactWhatsapp: { type: String },

    // ── Nearby Places ─────────────────────────────────────────────────────────
    nearbyPlaces: { type: [nearbyPlaceSchema], default: [] },

    // ── Availability ──────────────────────────────────────────────────────────
    isAvailable: { type: Boolean, default: true },
    availableRooms: { type: Number, default: 0, min: 0 },

    // ── Status & Moderation ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String, default: null },
    isVerified: { type: Boolean, default: false },

    // ── Data Quality Score ────────────────────────────────────────────────────
    // 1–5, auto-computed on creation but can be overridden by admin or owner
    dataQualityScore: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    // ── Analytics ─────────────────────────────────────────────────────────────
    views: { type: Number, default: 0 },
    inquiries: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtuals ────────────────────────────────────────────────────────────────

/**
 * rent — Computed from roomConfigs.
 * Returns { single: N, double: N, ... } keyed by shareType.
 * Replaces the old top-level `rent` stored field.
 */
pgSchema.virtual('rent').get(function () {
  if (!this.roomConfigs || this.roomConfigs.length === 0) return null;
  const result = {};
  this.roomConfigs.forEach((rc) => {
    if (rc.rent != null) result[rc.shareType] = rc.rent;
  });
  return Object.keys(result).length > 0 ? result : null;
});

/** Total beds across all room configs */
pgSchema.virtual('totalBeds').get(function () {
  if (!this.roomConfigs || this.roomConfigs.length === 0) return 0;
  return this.roomConfigs.reduce((sum, rc) => sum + (rc.totalBeds || 0), 0);
});

/** Available beds across all room configs */
pgSchema.virtual('availableBeds').get(function () {
  if (!this.roomConfigs || this.roomConfigs.length === 0) return 0;
  return this.roomConfigs.reduce((sum, rc) => sum + (rc.availableBeds || 0), 0);
});

/** Lowest rent across all room configurations */
pgSchema.virtual('minRent').get(function () {
  if (!this.roomConfigs || this.roomConfigs.length === 0) return null;
  const rents = this.roomConfigs.map((rc) => rc.rent).filter((r) => r != null && r > 0);
  return rents.length > 0 ? Math.min(...rents) : null;
});

/** Highest rent across all room configurations */
pgSchema.virtual('maxRent').get(function () {
  if (!this.roomConfigs || this.roomConfigs.length === 0) return null;
  const rents = this.roomConfigs.map((rc) => rc.rent).filter((r) => r != null && r > 0);
  return rents.length > 0 ? Math.max(...rents) : null;
});

// ─── Indexes ─────────────────────────────────────────────────────────────────
pgSchema.index({ status: 1, city: 1, createdAt: -1 });
pgSchema.index({ city: 1, area: 1 });
pgSchema.index({ status: 1 });
pgSchema.index({ owner: 1 });
pgSchema.index({ isVerified: 1 });
pgSchema.index({ 'roomConfigs.shareType': 1, 'roomConfigs.rent': 1 });
pgSchema.index({ food: 1, ac: 1 });
pgSchema.index({ gender: 1 });
pgSchema.index({ preferredTenants: 1 });
pgSchema.index({ dataQualityScore: 1 });
// Location query indexes
pgSchema.index({ googlePlaceId: 1 });
pgSchema.index({ owner: 1, googlePlaceId: 1 });
// Full-text search
pgSchema.index({ name: 'text', area: 'text', city: 'text', description: 'text' });
// Geospatial
pgSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('PG', pgSchema);

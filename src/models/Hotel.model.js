const mongoose = require('mongoose');

/**
 * Hotel Model — core entity for the Buffet Module.
 *
 * Every hotel is linked to an owner (User with isHotelOwner: true).
 * Hotels must be approved + verified by Admin before going live.
 *
 * Status flow:
 *   pending → approved / rejected → (if approved) → verified (optional badge)
 *   approved → suspended (admin action)
 */

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    caption: { type: String, trim: true, default: '' },
    isMain: { type: Boolean, default: false },
    order: { type: Number, default: 99 },
  },
  { _id: true }
);

const hotelSchema = new mongoose.Schema(
  {
    // ─── Ownership ───────────────────────────────────────────────────────────
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Hotel owner is required'],
    },

    // ─── Basic Info ───────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Hotel name is required'],
      trim: true,
      maxlength: [200, 'Hotel name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    tagline: {
      type: String,
      trim: true,
      maxlength: [200, 'Tagline cannot exceed 200 characters'],
    },

    // ─── Media ────────────────────────────────────────────────────────────────
    logo: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    coverImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    gallery: {
      type: [photoSchema],
      default: [],
    },

    // ─── Location ─────────────────────────────────────────────────────────────
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    areaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
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

    // ─── Geo ──────────────────────────────────────────────────────────────────
    latitude: { type: Number },
    longitude: { type: Number },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
    googlePlaceId: { type: String, trim: true },
    googleMapsLink: { type: String, trim: true },

    // ─── Contact ──────────────────────────────────────────────────────────────
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true,
    },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactWhatsapp: { type: String, trim: true },
    website: { type: String, trim: true },

    // ─── Dining Info ──────────────────────────────────────────────────────────
    cuisine: {
      type: [String],
      default: [],
    },
    foodType: {
      type: String,
      enum: ['veg', 'nonveg', 'both'],
      default: 'both',
    },
    seatingCapacity: {
      type: Number,
      min: 0,
      default: 0,
    },

    // ─── Facilities ───────────────────────────────────────────────────────────
    facilities: {
      type: [String],
      default: [],
      // Examples: 'AC', 'Parking', 'WiFi', 'Valet', 'Lift', 'Live Music',
      //           'Private Dining', 'Outdoor Seating', 'Rooftop', 'Family Room'
    },
    parkingAvailable: { type: Boolean, default: false },

    // ─── Pricing ──────────────────────────────────────────────────────────────
    priceRange: {
      min: { type: Number, min: 0 },
      max: { type: Number, min: 0 },
    },

    // ─── Rating & Reviews ──────────────────────────────────────────────────────
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },

    // ─── Status / Verification ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
    },
    rejectionReason: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: { type: Boolean, default: false }, // goes true only after admin approval

    // ─── Registration Backlink ────────────────────────────────────────────────
    registrationRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HotelRegistrationRequest',
      default: null,
    },

    // ─── Analytics ───────────────────────────────────────────────────────────
    views: { type: Number, default: 0 },
    totalBuffets: { type: Number, default: 0 },
    activeBuffets: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
hotelSchema.index({ status: 1, isActive: 1 });
hotelSchema.index({ city: 1, area: 1 });
hotelSchema.index({ cityId: 1, areaId: 1 });
hotelSchema.index({ owner: 1 });
hotelSchema.index({ isVerified: 1 });
hotelSchema.index({ avgRating: -1 });
hotelSchema.index({ location: '2dsphere' });
hotelSchema.index({ name: 'text', description: 'text', area: 'text', city: 'text' });

// ─── Virtual: main photo URL ───────────────────────────────────────────────────
hotelSchema.virtual('mainPhotoUrl').get(function () {
  if (this.coverImage?.url) return this.coverImage.url;
  const main = this.gallery?.find((p) => p.isMain);
  return main?.url || this.gallery?.[0]?.url || null;
});

module.exports = mongoose.model('Hotel', hotelSchema);

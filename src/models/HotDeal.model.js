const mongoose = require('mongoose');

/**
 * HotDeal Model — Production-grade deal schema.
 *
 * Key design decisions:
 *  - Status lifecycle: draft → scheduled → live → expired | paused
 *  - Categories are ObjectId refs to HotDealCategory (no hardcoded enums)
 *  - Images stored via Cloudinary (url + publicId + isMain) — same as Meetup/Buffet
 *  - Coupon supports 3 types: none | code | scratch
 *  - City/Area targeting: optional — null = visible everywhere
 *  - Analytics (views, claims, shares) denormalized for O(1) reads
 *  - Auto-scheduler transitions: scheduled→live, live→expired
 */

// ─── Status Lifecycle ─────────────────────────────────────────────────────────
const DEAL_STATUSES = [
  'draft',     // Admin created but not ready
  'scheduled', // Ready, waiting for startDate
  'live',      // Active and visible to users
  'paused',    // Admin-paused temporarily
  'expired',   // Past endDate or fully claimed
];

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

/**
 * Image sub-schema — Cloudinary backed.
 * Folder: 'pginfo/hot-deals'
 */
const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    isMain: { type: Boolean, default: false },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

const hotDealSchema = new mongoose.Schema(
  {
    // ─── Identity ───────────────────────────────────────────────────────────
    title: {
      type: String,
      required: [true, 'Deal title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [300, 'Short description cannot exceed 300 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },

    // ─── Category ────────────────────────────────────────────────────────────
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HotDealCategory',
      required: [true, 'Category is required'],
      index: true,
    },

    // ─── Cloudinary Images ──────────────────────────────────────────────────
    /**
     * images[] — ordered deal photos. First isMain:true = cover image.
     * Folder: 'pginfo/hot-deals'
     */
    images: [imageSchema],

    /**
     * coverImage — auto-synced from images[].find(img => img.isMain) or images[0].
     * Quick cover reference for card rendering (avoids array scan).
     */
    coverImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },

    // ─── Provider / Business ─────────────────────────────────────────────────
    providerName: {
      type: String,
      required: [true, 'Provider/business name is required'],
      trim: true,
      maxlength: [200, 'Provider name cannot exceed 200 characters'],
    },
    providerLogo: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    providerWebsite: {
      type: String,
      trim: true,
      default: null,
    },
    providerContact: {
      type: String,
      trim: true,
      default: null,
    },

    // ─── Pricing ─────────────────────────────────────────────────────────────
    originalPrice: {
      type: Number,
      required: [true, 'Original price is required'],
      min: [0, 'Price cannot be negative'],
    },
    dealPrice: {
      type: Number,
      required: [true, 'Deal price is required'],
      min: [0, 'Price cannot be negative'],
    },
    /**
     * discountPercent — stored explicitly so queries/sorting are possible.
     * Auto-computed in pre-save if not provided.
     * Formula: Math.round(((originalPrice - dealPrice) / originalPrice) * 100)
     */
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    currency: { type: String, default: 'INR' },

    // ─── Coupon ───────────────────────────────────────────────────────────────
    /**
     * couponType:
     *   none    — no coupon needed; just visit the deal link
     *   code    — fixed coupon code shown/copied by user
     *   scratch — code hidden behind a scratch card (premium UX)
     */
    couponType: {
      type: String,
      enum: ['none', 'code', 'scratch'],
      default: 'none',
    },
    couponCode: {
      type: String,
      trim: true,
      default: null,
    },
    couponNote: {
      type: String,
      trim: true,
      default: null, // e.g. "Apply at checkout"
    },

    // ─── Deal Link ────────────────────────────────────────────────────────────
    dealUrl: {
      type: String,
      trim: true,
      default: null,
    },
    ctaLabel: {
      type: String,
      trim: true,
      default: 'Get Deal', // e.g. "Book Now", "Shop Now", "Claim Offer"
    },

    // ─── Schedule ────────────────────────────────────────────────────────────
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },

    // ─── Availability ────────────────────────────────────────────────────────
    /**
     * availabilityType:
     *   unlimited — no quantity cap
     *   limited   — totalQuantity cap; expires when claimedCount >= totalQuantity
     */
    availabilityType: {
      type: String,
      enum: ['unlimited', 'limited'],
      default: 'unlimited',
    },
    totalQuantity: {
      type: Number,
      default: null,
      min: 1,
    },
    claimedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Location Targeting ───────────────────────────────────────────────────
    /**
     * cityIds / areaIds — optional targeting.
     * null/empty = visible in ALL cities (national deal).
     * Populated: visible only in those cities/areas.
     */
    cityIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'City' }],
    areaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Area' }],
    cityNames: [{ type: String, trim: true }],  // denormalized for display
    areaNames: [{ type: String, trim: true }],  // denormalized for display

    // ─── Rich Content ────────────────────────────────────────────────────────
    termsAndConditions: {
      type: String,
      trim: true,
      default: null,
    },
    howToRedeem: {
      type: String,
      trim: true,
      default: null,
    },
    highlights: [{ type: String, trim: true }], // bullet points for deal detail

    // ─── Lifecycle ───────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: DEAL_STATUSES,
      default: 'draft',
      index: true,
    },

    /**
     * isFeatured — shows deal in the Featured carousel on mobile home.
     * featuredUntil — auto-removes featured flag after this date (optional).
     */
    isFeatured: { type: Boolean, default: false, index: true },
    featuredUntil: { type: Date, default: null },

    // ─── Analytics (Denormalized) ─────────────────────────────────────────────
    analytics: {
      views: { type: Number, default: 0 },
      claims: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },

    // ─── Admin Metadata ───────────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    internalNote: {
      type: String,
      trim: true,
      default: null, // admin-only note; not shown to users
    },
    tags: [{ type: String, trim: true, lowercase: true }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/** isAvailable — runtime check: live + within dates + not fully claimed */
hotDealSchema.virtual('isAvailable').get(function () {
  const now = new Date();
  if (this.status !== 'live') return false;
  if (now < this.startDate || now > this.endDate) return false;
  if (this.availabilityType === 'limited' && this.claimedCount >= this.totalQuantity) return false;
  return true;
});

/** remainingQuantity — null if unlimited */
hotDealSchema.virtual('remainingQuantity').get(function () {
  if (this.availabilityType !== 'limited' || this.totalQuantity == null) return null;
  return Math.max(0, this.totalQuantity - this.claimedCount);
});

// ─── Pre-save hooks ───────────────────────────────────────────────────────────

hotDealSchema.pre('save', function (next) {
  // 1. Auto-compute discountPercent
  if (this.originalPrice > 0 && this.dealPrice >= 0) {
    this.discountPercent = Math.round(
      ((this.originalPrice - this.dealPrice) / this.originalPrice) * 100
    );
  }

  // 2. Sync coverImage from images array
  const mainImg = this.images.find((img) => img.isMain) || this.images[0];
  if (mainImg) {
    this.coverImage = { url: mainImg.url, publicId: mainImg.publicId };
  }

  // 3. Auto-transition to 'scheduled' if startDate in future when set to 'live'
  //    (actual live transition handled by scheduler)
  next();
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Discovery: live deals sorted by creation date
hotDealSchema.index({ status: 1, startDate: 1, endDate: 1 });

// Discovery: category-filtered live deals
hotDealSchema.index({ status: 1, category: 1, startDate: 1 });

// Discovery: city-scoped live deals
hotDealSchema.index({ status: 1, cityIds: 1, startDate: 1 });

// Discovery: featured live deals
hotDealSchema.index({ isFeatured: 1, status: 1, startDate: 1 });

// Discovery: top discounts
hotDealSchema.index({ status: 1, discountPercent: -1 });

// Scheduler: find deals to auto-activate
hotDealSchema.index({ status: 1, startDate: 1 });

// Scheduler: find deals to auto-expire
hotDealSchema.index({ status: 1, endDate: 1 });

// Admin management
hotDealSchema.index({ createdBy: 1, createdAt: -1 });
hotDealSchema.index({ status: 1, createdAt: -1 });
hotDealSchema.index({ isFeatured: 1, createdAt: -1 });

module.exports = mongoose.model('HotDeal', hotDealSchema);

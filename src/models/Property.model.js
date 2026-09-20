const mongoose = require('mongoose');

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

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
    duration: { type: Number },
    order: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const documentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    name: { type: String, required: true },
    documentType: {
      type: String,
      enum: ['floor_plan', 'brochure', 'rera_certificate', 'occupancy_certificate', 'title_deed', 'other'],
      default: 'other',
    },
    fileSize: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const nearbyPlaceSchema = new mongoose.Schema(
  {
    placeType: {
      type: String,
      enum: [
        'metro', 'bus_stop', 'railway_station', 'hospital', 'college', 'school',
        'it_park', 'shopping_mall', 'restaurant', 'bank_atm', 'park', 'pharmacy',
        'supermarket', 'highway', 'airport', 'other',
      ],
    },
    name: { type: String, trim: true },
    distance: { type: Number }, // in km
    walkTime: { type: Number }, // in minutes
    placeId: { type: String, trim: true },
    address: { type: String, trim: true },
  },
  { _id: false }
);

const pricingSchema = new mongoose.Schema(
  {
    expectedPrice: { type: Number, min: 0, required: true }, // Monthly rent OR Total sale price OR Starting rent for PG
    pricePerSqFt: { type: Number, min: 0 },
    securityDeposit: { type: Number, min: 0, default: 0 },
    depositMonths: { type: Number, min: 0 },
    maintenanceCharges: { type: Number, min: 0, default: 0 },
    maintenanceType: {
      type: String,
      enum: ['included', 'monthly_fixed', 'per_sqft_monthly', 'quarterly', 'yearly', 'none'],
      default: 'included',
    },
    bookingAmount: { type: Number, min: 0 },
    pricingNegotiable: { type: Boolean, default: false },
    camChargesPerSqFt: { type: Number, min: 0 },
    dgBackupCharges: { type: Number, min: 0 },
    taxGstApplicable: { type: Boolean, default: false },
  },
  { _id: false }
);

const brokerageSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['zero', 'fixed', 'percentage', 'months_rent'],
      default: 'zero',
    },
    amount: { type: Number, min: 0, default: 0 },
    description: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Embedded Category Details ────────────────────────────────────────────────
const pgDetailsSchema = require('./details/pgDetails.schema');
const residentialDetailsSchema = require('./details/residentialDetails.schema');
const commercialDetailsSchema = require('./details/commercialDetails.schema');

// ─── Main Schema ─────────────────────────────────────────────────────────────

const propertySchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    listedBy: {
      type: String,
      enum: ['owner', 'agent', 'builder', 'property_manager'],
      default: 'owner',
    },
    brokerage: { type: brokerageSchema, default: () => ({ type: 'zero', amount: 0 }) },

    // Classification
    category: {
      type: String,
      enum: ['pg', 'residential_rental', 'commercial'],
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['rent', 'sale'],
      required: true,
      default: 'rent',
      index: true,
    },

    // Identification
    title: {
      type: String,
      required: [true, 'Property title / name is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },

    // Location
    city: { type: String, required: true, trim: true, index: true },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    area: { type: String, required: true, trim: true, index: true },
    address: { type: String, required: true, trim: true },
    fullAddress: { type: String, trim: true },
    landmark: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },
    postalCode: { type: String, trim: true },
    googlePlaceId: { type: String, trim: true, index: true },
    latitude: { type: Number },
    longitude: { type: Number },
    mapsLink: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },

    // Pricing
    pricing: { type: pricingSchema, required: true },

    // Media
    photos: {
      type: [photoSchema],
      default: [],
      validate: {
        validator: function (v) { return v.length <= 30; },
        message: 'A property can have at most 30 photos',
      },
    },
    videos: {
      type: [videoSchema],
      default: [],
      validate: {
        validator: function (v) { return v.length <= 5; },
        message: 'A property can have at most 5 videos',
      },
    },
    documents: {
      type: [documentSchema],
      default: [],
    },

    // Amenities
    amenities: {
      type: [String],
      default: [],
      index: true,
    },

    // Contact
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true,
    },
    contactWhatsapp: { type: String, trim: true },
    contactEmail: { type: String, trim: true },
    preferredContactHours: { type: String, trim: true },

    // Surrounding Places
    nearbyPlaces: { type: [nearbyPlaceSchema], default: [] },

    // Moderation & Verification
    status: {
      type: String,
      enum: [
        'draft',
        'pending',
        'submitted',
        'pending_review',
        'approved',
        'rejected',
        'correction_required',
        'suspended',
        'archived',
      ],
      default: 'submitted',
      index: true,
    },
    moderationNotes: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    correctionComments: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    isVerified: { type: Boolean, default: false, index: true },
    verifiedAt: { type: Date, default: null },
    dataQualityScore: { type: Number, min: 1, max: 5, default: 1 },

    // Analytics & Visibility
    views: { type: Number, default: 0 },
    inquiries: { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false, index: true },

    // Category Details
    pgDetails: { type: pgDetailsSchema, default: null },
    residentialDetails: { type: residentialDetailsSchema, default: null },
    commercialDetails: { type: commercialDetailsSchema, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtuals for Backward Compatibility with PG callers ─────────────────────

/** `name` virtual maps to `title` for legacy clients */
propertySchema.virtual('name').get(function () {
  return this.title;
}).set(function (val) {
  this.title = val;
});

/** `propertyType` virtual maps category/subtype */
propertySchema.virtual('propertyType').get(function () {
  if (this.category === 'pg') {
    return this.pgDetails?.propertySubtype || 'PG';
  }
  if (this.category === 'residential_rental') {
    return this.residentialDetails?.propertySubtype || 'Apartment';
  }
  if (this.category === 'commercial') {
    return this.commercialDetails?.commercialSubtype || 'Commercial';
  }
  return this.category;
});

/** `roomConfigs` virtual maps to `pgDetails.roomConfigs` */
propertySchema.virtual('roomConfigs').get(function () {
  return this.pgDetails?.roomConfigs || [];
});

/** `minRent` virtual */
propertySchema.virtual('minRent').get(function () {
  if (this.category === 'pg' && this.pgDetails?.roomConfigs?.length > 0) {
    const rents = this.pgDetails.roomConfigs.map((rc) => Number(rc.rent)).filter((r) => !isNaN(r) && r > 0);
    if (rents.length > 0) return Math.min(...rents);
  }
  return this.pricing?.expectedPrice || null;
});

/** `maxRent` virtual */
propertySchema.virtual('maxRent').get(function () {
  if (this.category === 'pg' && this.pgDetails?.roomConfigs?.length > 0) {
    const rents = this.pgDetails.roomConfigs.map((rc) => Number(rc.rent)).filter((r) => !isNaN(r) && r > 0);
    if (rents.length > 0) return Math.max(...rents);
  }
  return this.pricing?.expectedPrice || null;
});

/** `totalBeds` virtual */
propertySchema.virtual('totalBeds').get(function () {
  if (this.category === 'pg' && this.pgDetails?.roomConfigs) {
    return this.pgDetails.roomConfigs.reduce((sum, rc) => sum + (rc.totalBeds || 0), 0);
  }
  return 0;
});

/** `availableBeds` virtual */
propertySchema.virtual('availableBeds').get(function () {
  if (this.category === 'pg' && this.pgDetails?.roomConfigs) {
    return this.pgDetails.roomConfigs.reduce((sum, rc) => sum + (rc.availableBeds || 0), 0);
  }
  return 0;
});

// ─── Indexes ─────────────────────────────────────────────────────────────────
propertySchema.index({ location: '2dsphere' });
propertySchema.index({ cityId: 1, status: 1 });
propertySchema.index({ status: 1, category: 1, purpose: 1, city: 1, 'pricing.expectedPrice': 1 });
propertySchema.index({ city: 1, area: 1, status: 1 });
propertySchema.index({ owner: 1, status: 1, createdAt: -1 });
propertySchema.index({ 'residentialDetails.bhk': 1, status: 1 });
propertySchema.index({ 'commercialDetails.commercialSubtype': 1, status: 1 });
propertySchema.index({ title: 'text', description: 'text', area: 'text', city: 'text', landmark: 'text' });

module.exports = mongoose.model('Property', propertySchema);

const mongoose = require('mongoose');

/**
 * City Model — managed by admins, consumed by mobile/web for city selection.
 *
 * Image stored via Cloudinary (url + publicId) — same pattern as PG photos.
 * Cities are seeded/created through the admin panel or the seedCities script.
 *
 * Key fields for location resolution:
 *  - aliases: alternate/colloquial names (e.g. "Bengaluru" for "Bangalore")
 *  - googlePlaceId: Google Maps Place ID for deduplication & validation
 *  - latitude/longitude: city center coordinates for geo search
 */
const citySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'City name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'City name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
    },
    image: {
      url: { type: String, default: null },        // Cloudinary secure_url
      publicId: { type: String, default: null },   // Cloudinary public_id
    },
    state: {
      type: String,
      trim: true,
      index: true,
    },
    country: {
      type: String,
      trim: true,
      default: 'India',
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 99, // Lower = displayed first; 1=Tier-1, 10=Tier-2, 50=Tier-3
    },

    // ── Location Resolution Fields ────────────────────────────────────────────
    // Alternate names used to match Google Places results to this city.
    // e.g. ['Bengaluru'] for name='Bangalore', ['Gurgaon'] for name='Gurugram'
    aliases: {
      type: [String],
      default: [],
    },
    // Google Maps Place ID for this city — prevents duplicate entries
    googlePlaceId: {
      type: String,
      trim: true,
      sparse: true,
    },
    // City center coordinates for geo/radius queries
    latitude: { type: Number },
    longitude: { type: Number },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
citySchema.index({ isActive: 1, order: 1 });
citySchema.index({ isActive: 1, state: 1, order: 1 });
citySchema.index({ aliases: 1 });  // for alias-based lookup during location resolve

// ─── Auto-generate slug from name before save ─────────────────────────────────
citySchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  next();
});

module.exports = mongoose.model('City', citySchema);


const mongoose = require('mongoose');

/**
 * City Model — managed by admins, consumed by mobile/web for city selection.
 *
 * Image stored via Cloudinary (url + publicId) — same pattern as PG photos.
 * Cities are seeded/created through the admin panel.
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
      default: 99, // Lower = displayed first
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
citySchema.index({ isActive: 1, order: 1 });
citySchema.index({ name: 1 }, { unique: true });
citySchema.index({ slug: 1 }, { unique: true, sparse: true });

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

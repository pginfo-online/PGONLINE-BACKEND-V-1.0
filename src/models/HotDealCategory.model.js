const mongoose = require('mongoose');

/**
 * HotDealCategory Model
 *
 * Admin-managed category system for HotDeals.
 * Supports emoji icons, theme colors, Cloudinary cover images,
 * ordering, and activation — mirroring MeetupCategory pattern.
 *
 * Initial 10 categories seeded via: src/scripts/seedHotDealCategories.js
 */
const hotDealCategorySchema = new mongoose.Schema(
  {
    // ─── Identity ─────────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: [100, 'Display name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },

    // ─── Visual Identity ──────────────────────────────────────────────────────
    /**
     * icon — emoji or Ionicons icon name shown on mobile category chips.
     * e.g. '🧹' or 'cart-outline'
     */
    icon: {
      type: String,
      trim: true,
      default: '🏷️',
    },
    /**
     * coverImage — uploaded via Cloudinary multipart from admin dashboard.
     * Folder: 'pginfo/hot-deal-categories'
     */
    coverImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    /**
     * color — hex color used for category chip / card accent on mobile & admin.
     * e.g. '#10B981'
     */
    color: {
      type: String,
      default: '#FF4B2B',
      trim: true,
    },

    // ─── Admin Control ────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    /**
     * order — lower number appears first in category strip.
     * Admin can reorder via PATCH /hot-deal-categories/:id/order
     */
    order: { type: Number, default: 99 },

    // ─── SEO ──────────────────────────────────────────────────────────────────
    seoDescription: {
      type: String,
      trim: true,
      maxlength: 160,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
hotDealCategorySchema.index({ isActive: 1, order: 1 });

// ─── Auto-generate slug from name ────────────────────────────────────────────
hotDealCategorySchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  if (!this.displayName) {
    this.displayName = this.name;
  }
  next();
});

module.exports = mongoose.model('HotDealCategory', hotDealCategorySchema);

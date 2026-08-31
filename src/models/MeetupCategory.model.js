const mongoose = require('mongoose');

/**
 * MeetupCategory Model
 *
 * Fully Admin-managed category/subcategory hierarchy for meetups.
 * Supports parent→child (category → subcategory) with one level of nesting.
 * Images (icon + cover) are stored via Cloudinary — same pattern as City model.
 *
 * Admin manages everything from the dashboard; mobile/web reads from public API.
 * Nothing is hardcoded in frontend or backend.
 */
const meetupCategorySchema = new mongoose.Schema(
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
    icon: {
      type: String,
      trim: true,
      default: '🎯',     // Emoji or icon identifier (e.g. 'laptop', '🎤')
    },
    /**
     * Cover image — uploaded via Cloudinary multipart from admin dashboard.
     * Folder: 'pginfo/meetup-categories'
     */
    coverImage: {
      url:      { type: String, default: null },    // Cloudinary secure_url
      publicId: { type: String, default: null },    // Cloudinary public_id (for deletion)
    },
    color: {
      type: String,
      default: '#4f46e5',   // Hex color for UI theming
      trim: true,
    },

    // ─── Hierarchy ────────────────────────────────────────────────────────────
    /**
     * parent: null → top-level category
     * parent: ObjectId → subcategory of that parent
     * Max depth: 1 (category > subcategory only)
     */
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetupCategory',
      default: null,
    },

    // ─── Admin Control ────────────────────────────────────────────────────────
    isActive:   { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    order:      { type: Number,  default: 99 },    // lower = shown first

    // ─── SEO / Discovery ──────────────────────────────────────────────────────
    seoName:        { type: String, trim: true },
    seoDescription: { type: String, trim: true, maxlength: 160 },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// slug is unique (inline above)
meetupCategorySchema.index({ parent: 1, isActive: 1, order: 1 }); // subcategory listing
meetupCategorySchema.index({ isActive: 1, isFeatured: 1, order: 1 }); // featured categories
meetupCategorySchema.index({ parent: 1 });

// ─── Auto-generate slug from name ────────────────────────────────────────────
meetupCategorySchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  // Auto-fill displayName from name if not set
  if (!this.displayName) {
    this.displayName = this.name;
  }
  next();
});

module.exports = mongoose.model('MeetupCategory', meetupCategorySchema);

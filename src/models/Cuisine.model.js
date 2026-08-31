const mongoose = require('mongoose');

/**
 * Cuisine Model — managed by admins, consumed by Hotel and Buffet for tagging.
 *
 * Examples: North Indian, South Indian, Chinese, Continental, Italian, etc.
 */
const cuisineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Cuisine name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Cuisine name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
    },
    icon: {
      type: String, // emoji or icon identifier
      trim: true,
      default: '🍽️',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 99,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
cuisineSchema.index({ isActive: 1, order: 1 });
cuisineSchema.index({ name: 1 }, { unique: true });
cuisineSchema.index({ slug: 1 }, { unique: true, sparse: true });

// ─── Auto-generate slug before save ───────────────────────────────────────────
cuisineSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  next();
});

module.exports = mongoose.model('Cuisine', cuisineSchema);

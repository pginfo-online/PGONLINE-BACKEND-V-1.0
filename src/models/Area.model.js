const mongoose = require('mongoose');

/**
 * Area Model — geographic subdivision of a City.
 *
 * Reusable across PGs, Buffets, and future local services.
 * Linked to City via cityId reference.
 * Areas are created and managed exclusively by Admin.
 */
const areaSchema = new mongoose.Schema(
  {
    city: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
      required: [true, 'City reference is required'],
      index: true,
    },
    cityName: {
      type: String,
      trim: true,
      required: [true, 'City name (denormalized) is required'],
    },
    name: {
      type: String,
      required: [true, 'Area name is required'],
      trim: true,
      maxlength: [100, 'Area name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 99, // lower = shown first
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
areaSchema.index({ city: 1, isActive: 1, order: 1 });
areaSchema.index({ city: 1, name: 1 }, { unique: true });
areaSchema.index({ city: 1, slug: 1 }, { unique: true, sparse: true });

// ─── Auto-generate slug before save ───────────────────────────────────────────
areaSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  next();
});

module.exports = mongoose.model('Area', areaSchema);

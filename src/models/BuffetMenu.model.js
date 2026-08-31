const mongoose = require('mongoose');

/**
 * BuffetMenu — the structured menu associated with a Buffet.
 *
 * A single Buffet can have multiple named sections (Starters, Main Course,
 * Desserts, Live Counter, etc.), each containing ordered food items.
 * This model supports multiple menu types per buffet.
 */

const menuItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      maxlength: [150, 'Item name cannot exceed 150 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
    },
    isVeg: { type: Boolean, default: true },
    isSpicy: { type: Boolean, default: false },
    isSignature: { type: Boolean, default: false }, // signature/special dish
    image: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    order: { type: Number, default: 99 },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true }
);

const menuSectionSchema = new mongoose.Schema(
  {
    sectionName: {
      type: String,
      required: [true, 'Section name is required'],
      trim: true,
      maxlength: [100, 'Section name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Section description cannot exceed 300 characters'],
    },
    order: { type: Number, default: 99 },
    icon: { type: String, default: '🍽️' }, // emoji icon for section
    items: {
      type: [menuItemSchema],
      default: [],
    },
  },
  { _id: true }
);

const buffetMenuSchema = new mongoose.Schema(
  {
    buffet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Buffet',
      required: [true, 'Buffet reference is required'],
      unique: true, // one menu per buffet (with multiple sections)
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },
    sections: {
      type: [menuSectionSchema],
      default: [],
    },
    totalItems: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    lastPublishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
buffetMenuSchema.index({ buffet: 1 }, { unique: true });
buffetMenuSchema.index({ hotel: 1 });

// ─── Pre-save: auto-compute totalItems ───────────────────────────────────────
buffetMenuSchema.pre('save', function (next) {
  this.totalItems = this.sections.reduce((sum, section) => sum + (section.items?.length || 0), 0);
  next();
});

module.exports = mongoose.model('BuffetMenu', buffetMenuSchema);

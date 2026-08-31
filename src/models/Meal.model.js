const mongoose = require('mongoose');

/**
 * Meal — daily meal menu for a PG.
 *
 * Each document = one calendar day's menu for a PG.
 * One menu per PG per day (compound unique index).
 *
 * Status flow:
 *   draft → published  (owner publishes → tenants notified)
 *   published → draft  (owner unpublishes)
 */

const mealItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['breakfast', 'lunch', 'dinner', 'snacks'],
      required: true,
    },
    items: [
      {
        type: String,
        trim: true,
        maxlength: 100,
      },
    ],
    // e.g. "8:00 AM - 9:30 AM"
    timing: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const mealSchema = new mongoose.Schema(
  {
    pg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PG',
      required: [true, 'PG reference is required'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },
    // The calendar date this menu is for (stored as midnight UTC)
    menuDate: {
      type: Date,
      required: [true, 'Menu date is required'],
    },
    meals: [mealItemSchema],
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [300, 'Notes cannot exceed 300 characters'],
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// One menu per PG per day
mealSchema.index({ pg: 1, menuDate: 1 }, { unique: true });
mealSchema.index({ pg: 1, status: 1 });
mealSchema.index({ owner: 1, menuDate: -1 });

module.exports = mongoose.model('Meal', mealSchema);

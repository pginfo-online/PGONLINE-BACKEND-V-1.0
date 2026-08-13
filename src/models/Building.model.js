const mongoose = require('mongoose');

/**
 * Building — physical building within a PG property.
 *
 * Hierarchy: Owner → PG → Building → Floor → Room → Bed → Tenant
 */
const buildingSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: [true, 'Building name is required'],
      trim: true,
      maxlength: [200, 'Building name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    totalFloors: {
      type: Number,
      min: [1, 'Must have at least 1 floor'],
      default: 1,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'under_construction', 'maintenance'],
      default: 'active',
    },
    address: {
      type: String,
      trim: true,
    },
    // Quick-access stats (derived, kept in sync by service layer)
    stats: {
      totalRooms:     { type: Number, default: 0, min: 0 },
      totalBeds:      { type: Number, default: 0, min: 0 },
      occupiedBeds:   { type: Number, default: 0, min: 0 },
      vacantBeds:     { type: Number, default: 0, min: 0 },
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
buildingSchema.index({ pg: 1, status: 1 });
buildingSchema.index({ owner: 1 });
buildingSchema.index({ pg: 1, createdAt: -1 });

module.exports = mongoose.model('Building', buildingSchema);

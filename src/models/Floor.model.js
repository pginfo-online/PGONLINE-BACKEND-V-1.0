const mongoose = require('mongoose');

/**
 * Floor — one floor within a Building.
 *
 * Hierarchy: PG → Building → Floor → Room → Bed → Tenant
 */
const floorSchema = new mongoose.Schema(
  {
    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      required: [true, 'Building reference is required'],
    },
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
    floorNumber: {
      type: Number,
      required: [true, 'Floor number is required'],
    },
    // Human-friendly label e.g. "Ground Floor", "1st Floor", "Terrace"
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Floor name cannot exceed 100 characters'],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'maintenance'],
      default: 'active',
    },
    // Quick-access stats
    stats: {
      totalRooms:   { type: Number, default: 0, min: 0 },
      totalBeds:    { type: Number, default: 0, min: 0 },
      occupiedBeds: { type: Number, default: 0, min: 0 },
      vacantBeds:   { type: Number, default: 0, min: 0 },
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
floorSchema.index({ building: 1, floorNumber: 1 }, { unique: true });
floorSchema.index({ pg: 1 });
floorSchema.index({ owner: 1 });

module.exports = mongoose.model('Floor', floorSchema);

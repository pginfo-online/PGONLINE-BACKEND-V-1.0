const mongoose = require('mongoose');

/**
 * Bed — smallest unit of occupancy within a Room.
 *
 * Hierarchy: PG → Building → Floor → Room → Bed → Tenant
 *
 * Status lifecycle:
 *   vacant → occupied  (when tenant is assigned)
 *   occupied → vacant  (when tenant vacates)
 *   any → maintenance  (when marked for maintenance)
 *   any → reserved     (when pre-booked)
 */
const bedSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: [true, 'Room reference is required'],
    },
    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Floor',
      required: [true, 'Floor reference is required'],
    },
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
    // Label within the room: "A", "B", "1", "2", etc.
    bedLabel: {
      type: String,
      required: [true, 'Bed label is required'],
      trim: true,
      maxlength: [10, 'Bed label cannot exceed 10 characters'],
    },
    status: {
      type: String,
      enum: ['vacant', 'occupied', 'reserved', 'maintenance'],
      default: 'vacant',
    },
    // Populated when status === 'occupied'
    currentTenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    // Override rent for this specific bed (falls back to Room.rentPerBed if null)
    rentOverride: {
      type: Number,
      min: [0, 'Rent cannot be negative'],
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [300, 'Notes cannot exceed 300 characters'],
    },
    // Track when bed became available last (for analytics)
    lastVacatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Bed label must be unique within a room
bedSchema.index({ room: 1, bedLabel: 1 }, { unique: true });
bedSchema.index({ pg: 1, status: 1 });
bedSchema.index({ building: 1, status: 1 });
bedSchema.index({ currentTenant: 1 });
bedSchema.index({ owner: 1 });

module.exports = mongoose.model('Bed', bedSchema);

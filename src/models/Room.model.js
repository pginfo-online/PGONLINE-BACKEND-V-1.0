const mongoose = require('mongoose');

/**
 * Room — a physical room on a Floor.
 *
 * Hierarchy: PG → Building → Floor → Room → Bed → Tenant
 */
const roomSchema = new mongoose.Schema(
  {
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
    // e.g. "101", "A12", "Ground-1"
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
      maxlength: [20, 'Room number cannot exceed 20 characters'],
    },
    shareType: {
      type: String,
      enum: ['single', 'double', 'triple', 'four', 'dormitory'],
      required: [true, 'Share type is required'],
    },
    // Maximum number of beds (drives bed creation)
    totalBeds: {
      type: Number,
      required: [true, 'Total beds is required'],
      min: [1, 'Room must have at least 1 bed'],
      max: [12, 'Room cannot have more than 12 beds'],
    },
    // Monthly rent per bed for this room
    rentPerBed: {
      type: Number,
      min: [0, 'Rent cannot be negative'],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'maintenance', 'renovation'],
      default: 'active',
    },
    // Room-level amenities (in addition to PG-level facilities)
    amenities: {
      type: [String],
      default: [],
      enum: [
        'AC', 'Fan', 'Attached Bathroom', 'Common Bathroom',
        'Balcony', 'Wardrobe', 'Study Table', 'Chair', 'Bed',
        'Mattress', 'Pillow', 'Window', 'CCTV', 'Locker',
      ],
    },
    // Derived counters — kept in sync by service layer
    occupiedBeds:     { type: Number, default: 0, min: 0 },
    vacantBeds:       { type: Number, default: 0, min: 0 },
    maintenanceBeds:  { type: Number, default: 0, min: 0 },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Room number must be unique within a building
roomSchema.index({ building: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ floor: 1 });
roomSchema.index({ pg: 1, status: 1 });
roomSchema.index({ owner: 1 });

module.exports = mongoose.model('Room', roomSchema);

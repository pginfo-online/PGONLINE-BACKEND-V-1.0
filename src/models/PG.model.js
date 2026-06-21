const mongoose = require('mongoose');

const pgSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'PG name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      enum: ['Pune', 'Mumbai', 'Delhi'],
    },
    area: {
      type: String,
      required: [true, 'Area is required'],
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    mapsLink: {
      type: String,
      trim: true,
    },
    latitude: { type: Number },
    longitude: { type: Number },
    rent: {
      single: { type: Number, min: 0 },
      double: { type: Number, min: 0 },
      triple: { type: Number, min: 0 },
    },
    food: {
      type: String,
      enum: ['veg', 'nonveg', 'both', 'none'],
      default: 'none',
    },
    foodIncluded: {
      type: Boolean,
      default: false,
    },
    ac: {
      type: Boolean,
      default: false,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'any'],
      default: 'any',
    },
    facilities: {
      type: [String],
      default: [],
      enum: [
        'WiFi', 'Laundry', 'Parking', 'Gym', 'CCTV', 'Power Backup',
        'Hot Water', 'Housekeeping', 'TV', 'Refrigerator', 'RO Water',
        'Study Room', 'Lift', 'Security Guard', 'Kitchen Access',
      ],
    },
    photos: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        isMain: { type: Boolean, default: false },
      },
    ],
    videos: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
    },
    contactWhatsapp: {
      type: String,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    availableRooms: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Analytics
    views: { type: Number, default: 0 },
    inquiries: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
pgSchema.index({ city: 1, area: 1 });
pgSchema.index({ status: 1 });
pgSchema.index({ owner: 1 });
pgSchema.index({ isVerified: 1 });
pgSchema.index({ 'rent.single': 1, 'rent.double': 1 });
pgSchema.index({ food: 1, ac: 1 });
// Text index for search
pgSchema.index({ name: 'text', area: 'text', city: 'text', description: 'text' });

module.exports = mongoose.model('PG', pgSchema);

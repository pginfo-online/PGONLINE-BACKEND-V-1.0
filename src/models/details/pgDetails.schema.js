const mongoose = require('mongoose');

const roomConfigSchema = new mongoose.Schema(
  {
    shareType: {
      type: String,
      enum: ['single', 'double', 'triple', 'four', 'dormitory', 'studio'],
      required: true,
    },
    rent: { type: Number, min: 0, required: true },
    depositAmount: { type: Number, min: 0 },
    totalBeds: { type: Number, min: 0, default: 0 },
    availableBeds: { type: Number, min: 0, default: 0 },
    roomSize: { type: String, trim: true },
    furnitureIncluded: { type: Boolean, default: false },
    acIncluded: { type: Boolean, default: false },
    bathroomType: {
      type: String,
      enum: ['attached', 'shared', 'common-floor'],
      default: 'shared',
    },
    amenities: { type: [String], default: [] },
  },
  { _id: true }
);

const mealTimingSchema = new mongoose.Schema(
  {
    provided: { type: Boolean, default: true },
    from: { type: String, trim: true },
    to: { type: String, trim: true },
  },
  { _id: false }
);

const foodInfoSchema = new mongoose.Schema(
  {
    provided: { type: Boolean, default: false },
    type: { type: String, enum: ['veg', 'nonveg', 'both'], default: 'veg' },
    includedInRent: { type: Boolean, default: false },
    mealCostPerMonth: { type: Number, min: 0 },
    monthlyFoodCharge: { type: Number, min: 0 },
    mealsPerDay: { type: Number, min: 1, max: 3 },
    mealTimings: {
      breakfast: mealTimingSchema,
      lunch: mealTimingSchema,
      dinner: mealTimingSchema,
    },
    dailySchedule: {
      breakfast: mealTimingSchema,
      lunch: mealTimingSchema,
      dinner: mealTimingSchema,
    },
    kitchenAccess: { type: Boolean, default: false },
    kitchenAccessForTenants: { type: Boolean, default: false },
    kitchenHours: { type: String, trim: true },
    messType: {
      type: String,
      enum: ['in-house', 'outsourced', 'tiffin-service', 'self'],
    },
  },
  { _id: false }
);

const rulesSchema = new mongoose.Schema(
  {
    smokingAllowed: { type: Boolean, default: false },
    alcoholAllowed: { type: Boolean, default: false },
    petsAllowed: { type: Boolean, default: false },
    guestsAllowed: { type: Boolean, default: true },
    visitorPolicy: {
      type: String,
      enum: ['not_allowed', 'lobby_only', 'room_allowed'],
      default: 'lobby_only',
    },
    curfewTime: { type: String, trim: true },
    cookingAllowed: { type: Boolean, default: false },
    nonVegAllowed: { type: Boolean, default: true },
    customRules: { type: [String], default: [] },
  },
  { _id: false }
);

const pgDetailsSchema = new mongoose.Schema(
  {
    propertySubtype: {
      type: String,
      enum: ['PG', 'Hostel', 'Co-living', 'Student Accommodation', 'Working Men PG', 'Working Women PG'],
      default: 'PG',
    },
    roomConfigs: {
      type: [roomConfigSchema],
      default: [],
    },
    floors: { type: Number, min: 1 },
    totalRooms: { type: Number, min: 1 },
    propertyAge: { type: Number, min: 0 },
    gender: {
      type: String,
      enum: ['male', 'female', 'any'],
      default: 'any',
      index: true,
    },
    preferredTenants: {
      type: [String],
      enum: ['student', 'working_professional', 'family', 'any'],
      default: ['any'],
    },
    food: {
      type: String,
      enum: ['veg', 'nonveg', 'both', 'none'],
      default: 'none',
      index: true,
    },
    foodIncluded: { type: Boolean, default: false },
    foodInfo: { type: foodInfoSchema, default: () => ({}) },
    ac: { type: Boolean, default: false },
    rules: { type: rulesSchema, default: () => ({}) },
    noticePeriod: { type: Number, min: 0 },
    minStay: { type: Number, min: 0 },
    maxStay: { type: Number, min: 0 },
    isAvailable: { type: Boolean, default: true },
    availableRooms: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

module.exports = pgDetailsSchema;

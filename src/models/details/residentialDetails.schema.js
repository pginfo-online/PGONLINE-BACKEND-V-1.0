const mongoose = require('mongoose');

const furnishingDetailsSchema = new mongoose.Schema(
  {
    fans: { type: Number, default: 0 },
    lights: { type: Number, default: 0 },
    wardrobes: { type: Number, default: 0 },
    modularKitchen: { type: Boolean, default: false },
    geysers: { type: Number, default: 0 },
    acCount: { type: Number, default: 0 },
    tv: { type: Boolean, default: false },
    refrigerator: { type: Boolean, default: false },
    washingMachine: { type: Boolean, default: false },
    sofa: { type: Boolean, default: false },
    diningTable: { type: Boolean, default: false },
    bedsCount: { type: Number, default: 0 },
    mattresses: { type: Boolean, default: false },
    curtains: { type: Boolean, default: false },
    waterPurifier: { type: Boolean, default: false },
    gasPipeline: { type: Boolean, default: false },
  },
  { _id: false }
);

const residentialDetailsSchema = new mongoose.Schema(
  {
    propertySubtype: {
      type: String,
      enum: [
        'apartment_flat',
        'independent_house',
        'villa',
        'builder_floor',
        'studio_apartment',
        'penthouse',
        'duplex',
      ],
      required: true,
      default: 'apartment_flat',
    },
    bhk: {
      type: String,
      enum: ['1RK', '1BHK', '2BHK', '2.5BHK', '3BHK', '3.5BHK', '4BHK', '5BHK+'],
      required: true,
      index: true,
    },
    bedrooms: { type: Number, min: 1, required: true },
    bathrooms: { type: Number, min: 1, required: true },
    balconies: { type: Number, min: 0, default: 0 },

    // Area & Measurement
    carpetAreaSqFt: { type: Number, min: 10, required: true },
    superBuiltUpAreaSqFt: { type: Number, min: 10 },
    plotAreaSqYards: { type: Number, min: 0 },

    // Floor & Building
    floorNumber: { type: Number },
    totalFloors: { type: Number, min: 1 },
    facing: {
      type: String,
      enum: ['East', 'North', 'North-East', 'West', 'South', 'South-East', 'South-West', 'North-West', 'Don\'t Know'],
      default: 'Don\'t Know',
    },
    propertyAgeYears: { type: Number, min: 0 },

    // Furnishing
    furnishingStatus: {
      type: String,
      enum: ['unfurnished', 'semi_furnished', 'fully_furnished'],
      required: true,
      default: 'semi_furnished',
      index: true,
    },
    furnishingDetails: { type: furnishingDetailsSchema, default: () => ({}) },

    // Parking
    reservedCoveredParking: { type: Number, min: 0, default: 0 },
    openParking: { type: Number, min: 0, default: 0 },

    // Tenant Preferences & Policies
    preferredTenants: {
      type: [String],
      enum: ['family', 'bachelors_male', 'bachelors_female', 'company_lease', 'any'],
      default: ['any'],
    },
    nonVegAllowed: { type: Boolean, default: true },
    petsAllowed: { type: Boolean, default: false },
    lockInPeriodMonths: { type: Number, min: 0, default: 0 },
    noticePeriodDays: { type: Number, min: 0, default: 30 },

    // Society & Infrastructure
    societyName: { type: String, trim: true },
    gatedSecurity: { type: Boolean, default: true },
    waterSupply: {
      type: [String],
      enum: ['corporation', 'borewell', '24_7_water'],
      default: ['corporation'],
    },
    powerBackup: {
      type: String,
      enum: ['none', 'partial_common_areas', 'full'],
      default: 'partial_common_areas',
    },
    availableFrom: { type: Date, default: Date.now },
  },
  { _id: false }
);

module.exports = residentialDetailsSchema;

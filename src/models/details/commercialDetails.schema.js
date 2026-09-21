const mongoose = require('mongoose');

const fitoutDetailsSchema = new mongoose.Schema(
  {
    workstationsCount: { type: Number, min: 0, default: 0 },
    cabinsCount: { type: Number, min: 0, default: 0 },
    meetingRoomsCount: { type: Number, min: 0, default: 0 },
    conferenceRoomsCount: { type: Number, min: 0, default: 0 },
    receptionArea: { type: Boolean, default: false },
    pantryType: {
      type: String,
      enum: ['dry', 'wet', 'cafeteria', 'none'],
      default: 'none',
    },
    privateWashrooms: { type: Number, min: 0, default: 0 },
    publicWashroomsPerFloor: { type: Number, min: 0, default: 0 },
    centralAirConditioning: { type: Boolean, default: false },
  },
  { _id: false }
);

const leaseTermsSchema = new mongoose.Schema(
  {
    leaseDurationYears: { type: Number, min: 1, default: 3 },
    lockInPeriodMonths: { type: Number, min: 0, default: 12 },
    fitOutPeriodDays: { type: Number, min: 0, default: 0 },
    annualRentEscalationPercent: { type: Number, min: 0, default: 5 },
    escalationTerms: { type: String, trim: true },
    subLeaseAllowed: { type: Boolean, default: false },
  },
  { _id: false }
);

const saleTermsSchema = new mongoose.Schema(
  {
    ownershipType: {
      type: String,
      enum: ['freehold', 'leasehold', 'power_of_attorney', 'cooperative_society'],
      default: 'freehold',
    },
    possessionStatus: {
      type: String,
      enum: ['ready_to_move', 'under_construction'],
      default: 'ready_to_move',
    },
    possessionDate: { type: Date },
    reraApproved: { type: Boolean, default: false },
    reraRegistrationNumber: { type: String, trim: true },
    approvedByBanks: { type: [String], default: [] },
  },
  { _id: false }
);

const commercialDetailsSchema = new mongoose.Schema(
  {
    commercialSubtype: {
      type: String,
      enum: [
        'office_space',
        'retail_shop',
        'showroom',
        'warehouse_godown',
        'co_working',
        'industrial_shed_factory',
        'commercial_plot_land',
        'commercial_building_floor',
      ],
      required: true,
      index: true,
    },

    // Space & Dimensions
    carpetAreaSqFt: { type: Number, min: 10, required: true },
    superBuiltUpAreaSqFt: { type: Number, min: 0 },
    plotAreaSqFt: { type: Number, min: 0 },
    ceilingHeightFt: { type: Number, min: 0 },
    entranceWidthFt: { type: Number, min: 0 },

    // Floors & Lifts
    floorNumber: { type: Number },
    totalFloors: { type: Number, min: 1 },
    passengerLifts: { type: Number, min: 0, default: 0 },
    goodsLifts: { type: Number, min: 0, default: 0 },
    loadingDocks: { type: Number, min: 0, default: 0 },

    // Fit-out
    fitoutStatus: {
      type: String,
      enum: ['bare_shell', 'warm_shell', 'fully_furnished_plug_and_play'],
      required: true,
      default: 'bare_shell',
    },
    fitoutDetails: { type: fitoutDetailsSchema, default: () => ({}) },

    // Power & Capacity
    powerLoadKW: { type: Number, min: 0 },
    powerBackupCapacityKVA: { type: Number, min: 0 },
    threePhaseConnection: { type: Boolean, default: false },
    floorLoadCapacityTonsPerSqM: { type: Number, min: 0 },

    // Parking
    coveredParkingSlots: { type: Number, min: 0, default: 0 },
    openParkingSlots: { type: Number, min: 0, default: 0 },
    parkingRatioPer1000SqFt: { type: Number, min: 0 },

    // Lease / Rent Terms
    leaseTerms: { type: leaseTermsSchema, default: () => ({}) },

    // Sale Terms
    saleTerms: { type: saleTermsSchema, default: () => ({}) },

    // Safety & Statutory
    fireSafetyNOC: { type: Boolean, default: false },
    fireSprinklersInstalled: { type: Boolean, default: false },
    fireHydrants: { type: Boolean, default: false },
    buildingGrade: {
      type: String,
      enum: ['grade_a', 'grade_b', 'grade_c', 'unrated'],
      default: 'unrated',
    },
    gstinNumber: { type: String, trim: true },
    availableFrom: { type: Date, default: Date.now },
  },
  { _id: false }
);

module.exports = commercialDetailsSchema;

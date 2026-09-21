const { z } = require('zod');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const nullableCoercedNumber = z.preprocess((val) => {
  if (val === null || val === '') return null;
  if (val === undefined) return undefined;
  const num = Number(val);
  return isNaN(num) ? val : num;
}, z.number().min(0).nullable().optional());

const requiredCoercedNumber = (msg = 'Valid number required', min = 0) =>
  z.preprocess((val) => {
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number({ required_error: msg, invalid_type_error: msg }).min(min, msg));

// ─── Media & Sub-schemas ──────────────────────────────────────────────────────

const photoSchema = z.union([
  z.string().url('Enter a valid photo URL').transform((url) => ({
    url,
    publicId: '',
    caption: '',
    isMain: false,
    order: 0,
  })),
  z.object({
    url: z.string().url('Enter a valid photo URL'),
    publicId: z.string().optional().default(''),
    caption: z.string().optional().default(''),
    isMain: z.boolean().default(false),
    order: z.number().optional().default(0),
    _id: z.any().optional(),
  }),
]);

const videoSchema = z.union([
  z.string().url('Enter a valid video URL').transform((url) => ({
    url,
    publicId: '',
    title: 'Walkthrough Video Tour',
    duration: 0,
    order: 0,
  })),
  z.object({
    url: z.string().url('Enter a valid video URL'),
    publicId: z.string().optional().default(''),
    thumbnailUrl: z.string().optional(),
    title: z.string().max(150).optional().default('Walkthrough Video Tour'),
    duration: z.number().optional().default(0),
    order: z.number().optional().default(0),
    _id: z.any().optional(),
  }),
]);

const documentSchema = z.object({
  url: z.string().url('Enter a valid document URL'),
  publicId: z.string(),
  name: z.string().min(1, 'Document name is required'),
  documentType: z.enum(['floor_plan', 'brochure', 'rera_certificate', 'occupancy_certificate', 'title_deed', 'other']).default('other'),
  fileSize: z.number().optional(),
  _id: z.any().optional(),
});

const nearbyPlaceSchema = z.object({
  placeType: z.enum([
    'metro', 'bus_stop', 'railway_station', 'hospital', 'college', 'school',
    'it_park', 'shopping_mall', 'restaurant', 'bank_atm', 'park', 'pharmacy',
    'supermarket', 'highway', 'airport', 'other',
  ]),
  name: z.string().min(1, 'Place name is required'),
  distance: z.coerce.number(),
  walkTime: nullableCoercedNumber,
  placeId: z.string().optional(),
  address: z.string().optional(),
});

const pricingSchema = z.object({
  expectedPrice: requiredCoercedNumber('Price / Rent amount is required'),
  pricePerSqFt: nullableCoercedNumber,
  securityDeposit: nullableCoercedNumber,
  depositMonths: nullableCoercedNumber,
  maintenanceCharges: nullableCoercedNumber,
  maintenanceType: z.enum(['included', 'monthly_fixed', 'per_sqft_monthly', 'quarterly', 'yearly', 'none']).default('included'),
  bookingAmount: nullableCoercedNumber,
  pricingNegotiable: z.coerce.boolean().optional(),
  camChargesPerSqFt: nullableCoercedNumber,
  dgBackupCharges: nullableCoercedNumber,
  taxGstApplicable: z.coerce.boolean().optional(),
});

const brokerageSchema = z.object({
  type: z.enum(['zero', 'fixed', 'percentage', 'months_rent']).default('zero'),
  amount: nullableCoercedNumber,
  description: z.string().optional(),
}).optional();

// ─── PG Details Schema ────────────────────────────────────────────────────────

const roomConfigSchema = z.object({
  shareType: z.enum(['single', 'double', 'triple', 'four', 'dormitory', 'studio', 'other']).default('single'),
  rent: z.coerce.number().min(0).optional(),
  monthlyRent: z.coerce.number().min(0).optional(),
  depositAmount: nullableCoercedNumber,
  deposit: nullableCoercedNumber,
  sharing: nullableCoercedNumber,
  totalBeds: nullableCoercedNumber,
  availableBeds: nullableCoercedNumber,
  roomSize: z.string().optional(),
  furnitureIncluded: z.coerce.boolean().optional(),
  acIncluded: z.coerce.boolean().optional(),
  bathroomType: z.enum(['attached', 'shared', 'common-floor']).optional(),
  amenities: z.array(z.string()).optional(),
  _id: z.any().optional(),
}).transform((rc) => {
  const rentVal = rc.rent ?? rc.monthlyRent ?? 0;
  const depVal = rc.depositAmount ?? rc.deposit ?? null;
  return {
    ...rc,
    rent: rentVal,
    monthlyRent: rentVal,
    depositAmount: depVal,
    deposit: depVal,
  };
});

const pgDetailsSchema = z.object({
  propertySubtype: z.enum(['PG', 'Hostel', 'Co-living', 'Student Accommodation', 'Working Men PG', 'Working Women PG']).default('PG'),
  roomConfigs: z.array(roomConfigSchema).min(1, 'At least one room configuration is required for PG listings'),
  floors: nullableCoercedNumber,
  totalRooms: nullableCoercedNumber,
  propertyAge: nullableCoercedNumber,
  gender: z.enum(['male', 'female', 'any']).default('any'),
  preferredTenants: z.array(z.enum(['student', 'working_professional', 'family', 'any'])).default(['any']),
  food: z.enum(['veg', 'nonveg', 'both', 'none']).default('none'),
  foodIncluded: z.coerce.boolean().default(false),
  foodInfo: z.object({
    provided: z.coerce.boolean().optional(),
    type: z.enum(['veg', 'nonveg', 'both']).optional(),
    includedInRent: z.coerce.boolean().optional(),
    mealCostPerMonth: nullableCoercedNumber,
    monthlyFoodCharge: nullableCoercedNumber,
    mealsPerDay: z.coerce.number().min(1).max(3).optional(),
    mealTimings: z.object({
      breakfast: z.object({ provided: z.coerce.boolean().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
      lunch: z.object({ provided: z.coerce.boolean().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
      dinner: z.object({ provided: z.coerce.boolean().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
    }).nullable().optional(),
    dailySchedule: z.object({
      breakfast: z.object({ provided: z.coerce.boolean().optional(), start: z.string().optional(), end: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
      lunch: z.object({ provided: z.coerce.boolean().optional(), start: z.string().optional(), end: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
      dinner: z.object({ provided: z.coerce.boolean().optional(), start: z.string().optional(), end: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
    }).nullable().optional(),
    kitchenAccess: z.coerce.boolean().optional(),
    kitchenAccessForTenants: z.coerce.boolean().optional(),
    kitchenHours: z.string().optional(),
    messType: z.enum(['in-house', 'outsourced', 'tiffin-service', 'self']).optional(),
  }).nullable().optional().transform((val) => {
    if (!val) return val;
    const foodCost = val.mealCostPerMonth ?? val.monthlyFoodCharge ?? 0;
    const kAccess = val.kitchenAccess ?? val.kitchenAccessForTenants ?? false;
    return {
      ...val,
      mealCostPerMonth: foodCost,
      monthlyFoodCharge: foodCost,
      kitchenAccess: kAccess,
      kitchenAccessForTenants: kAccess,
    };
  }),
  ac: z.coerce.boolean().default(false),
  rules: z.object({
    smokingAllowed: z.coerce.boolean().optional(),
    alcoholAllowed: z.coerce.boolean().optional(),
    petsAllowed: z.coerce.boolean().optional(),
    guestsAllowed: z.coerce.boolean().optional(),
    visitorPolicy: z.enum(['not_allowed', 'lobby_only', 'room_allowed']).optional(),
    curfewTime: z.string().optional(),
    cookingAllowed: z.coerce.boolean().optional(),
    nonVegAllowed: z.coerce.boolean().optional(),
    customRules: z.array(z.string()).optional(),
  }).nullable().optional(),
  noticePeriod: nullableCoercedNumber,
  minStay: nullableCoercedNumber,
  maxStay: nullableCoercedNumber,
  isAvailable: z.coerce.boolean().default(true),
  availableRooms: nullableCoercedNumber,
});

// ─── Residential Details Schema ───────────────────────────────────────────────

const residentialDetailsSchema = z.object({
  propertySubtype: z.enum([
    'apartment_flat',
    'independent_house',
    'villa',
    'builder_floor',
    'studio_apartment',
    'penthouse',
    'duplex',
  ]).default('apartment_flat'),
  bhk: z.enum(['1RK', '1BHK', '2BHK', '2.5BHK', '3BHK', '3.5BHK', '4BHK', '5BHK+']),
  bedrooms: z.coerce.number().min(1, 'Bedrooms count must be at least 1'),
  bathrooms: z.coerce.number().min(1, 'Bathrooms count must be at least 1'),
  balconies: nullableCoercedNumber,
  carpetAreaSqFt: requiredCoercedNumber('Carpet area must be at least 10 sq. ft.', 10),
  superBuiltUpAreaSqFt: nullableCoercedNumber,
  plotAreaSqYards: nullableCoercedNumber,
  floorNumber: nullableCoercedNumber,
  totalFloors: nullableCoercedNumber,
  facing: z.enum(['East', 'North', 'North-East', 'West', 'South', 'South-East', 'South-West', 'North-West', 'Don\'t Know']).default('Don\'t Know'),
  propertyAgeYears: nullableCoercedNumber,
  furnishingStatus: z.enum(['unfurnished', 'semi_furnished', 'fully_furnished']).default('semi_furnished'),
  furnishingDetails: z.object({
    fans: nullableCoercedNumber,
    lights: nullableCoercedNumber,
    wardrobes: nullableCoercedNumber,
    modularKitchen: z.coerce.boolean().optional(),
    geysers: nullableCoercedNumber,
    acCount: nullableCoercedNumber,
    tv: z.coerce.boolean().optional(),
    refrigerator: z.coerce.boolean().optional(),
    washingMachine: z.coerce.boolean().optional(),
    sofa: z.coerce.boolean().optional(),
    diningTable: z.coerce.boolean().optional(),
    bedsCount: nullableCoercedNumber,
    mattresses: z.coerce.boolean().optional(),
    curtains: z.coerce.boolean().optional(),
    waterPurifier: z.coerce.boolean().optional(),
    gasPipeline: z.coerce.boolean().optional(),
  }).nullable().optional(),
  reservedCoveredParking: nullableCoercedNumber,
  openParking: nullableCoercedNumber,
  preferredTenants: z.array(z.enum(['family', 'bachelors_male', 'bachelors_female', 'company_lease', 'any'])).default(['any']),
  nonVegAllowed: z.coerce.boolean().default(true),
  petsAllowed: z.coerce.boolean().default(false),
  lockInPeriodMonths: nullableCoercedNumber,
  noticePeriodDays: nullableCoercedNumber,
  societyName: z.string().optional(),
  gatedSecurity: z.coerce.boolean().default(true),
  waterSupply: z.array(z.enum(['corporation', 'borewell', '24_7_water'])).optional(),
  powerBackup: z.enum(['none', 'partial_common_areas', 'full']).default('partial_common_areas'),
  availableFrom: z.string().optional(),
});

// ─── Commercial Details Schema ────────────────────────────────────────────────

const commercialDetailsSchema = z.object({
  commercialSubtype: z.enum([
    'office_space',
    'retail_shop',
    'showroom',
    'warehouse_godown',
    'co_working',
    'industrial_shed_factory',
    'commercial_plot_land',
    'commercial_building_floor',
  ]),
  carpetAreaSqFt: requiredCoercedNumber('Carpet area must be at least 10 sq. ft.', 10),
  superBuiltUpAreaSqFt: nullableCoercedNumber,
  plotAreaSqFt: nullableCoercedNumber,
  ceilingHeightFt: nullableCoercedNumber,
  entranceWidthFt: nullableCoercedNumber,
  floorNumber: nullableCoercedNumber,
  totalFloors: nullableCoercedNumber,
  passengerLifts: nullableCoercedNumber,
  goodsLifts: nullableCoercedNumber,
  loadingDocks: nullableCoercedNumber,
  fitoutStatus: z.enum(['bare_shell', 'warm_shell', 'fully_furnished_plug_and_play']).default('bare_shell'),
  fitoutDetails: z.object({
    workstationsCount: nullableCoercedNumber,
    cabinsCount: nullableCoercedNumber,
    meetingRoomsCount: nullableCoercedNumber,
    conferenceRoomsCount: nullableCoercedNumber,
    receptionArea: z.coerce.boolean().optional(),
    pantryType: z.enum(['dry', 'wet', 'cafeteria', 'none']).default('none'),
    privateWashrooms: nullableCoercedNumber,
    publicWashroomsPerFloor: nullableCoercedNumber,
    centralAirConditioning: z.coerce.boolean().optional(),
  }).nullable().optional(),
  powerLoadKW: nullableCoercedNumber,
  powerBackupCapacityKVA: nullableCoercedNumber,
  threePhaseConnection: z.coerce.boolean().optional(),
  floorLoadCapacityTonsPerSqM: nullableCoercedNumber,
  coveredParkingSlots: nullableCoercedNumber,
  openParkingSlots: nullableCoercedNumber,
  parkingRatioPer1000SqFt: nullableCoercedNumber,
  leaseTerms: z.object({
    leaseDurationYears: nullableCoercedNumber,
    lockInPeriodMonths: nullableCoercedNumber,
    fitOutPeriodDays: nullableCoercedNumber,
    annualRentEscalationPercent: nullableCoercedNumber,
    escalationTerms: z.string().optional(),
    subLeaseAllowed: z.coerce.boolean().optional(),
  }).nullable().optional(),
  saleTerms: z.object({
    ownershipType: z.enum(['freehold', 'leasehold', 'power_of_attorney', 'cooperative_society']).default('freehold'),
    possessionStatus: z.enum(['ready_to_move', 'under_construction']).default('ready_to_move'),
    possessionDate: z.string().optional(),
    reraApproved: z.coerce.boolean().optional(),
    reraRegistrationNumber: z.string().optional(),
    approvedByBanks: z.array(z.string()).optional(),
  }).nullable().optional(),
  fireSafetyNOC: z.coerce.boolean().optional(),
  fireSprinklersInstalled: z.coerce.boolean().optional(),
  fireHydrants: z.coerce.boolean().optional(),
  buildingGrade: z.enum(['grade_a', 'grade_b', 'grade_c', 'unrated']).default('unrated'),
  gstinNumber: z.string().optional(),
  availableFrom: z.string().optional(),
});

// ─── Base Property Fields ─────────────────────────────────────────────────────

const basePropertyFields = {
  title: z.string().min(3, 'Property title must be at least 3 characters').max(200),
  name: z.string().nullable().optional(), // for backwards compatibility
  description: z.string().max(5000).nullable().optional(),
  category: z.enum(['pg', 'residential_rental', 'commercial']),
  purpose: z.enum(['rent', 'sale']).default('rent'),
  listedBy: z.enum(['owner', 'agent', 'builder', 'property_manager']).default('owner'),
  brokerage: brokerageSchema.nullable().optional(),

  // Location
  city: z.string().min(2, 'City is required').max(100),
  cityId: z.string().nullable().optional(),
  area: z.string().min(2, 'Area is required').max(100),
  address: z.string().min(5, 'Address is required').max(500),
  fullAddress: z.string().nullable().optional(),
  landmark: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
  latitude: z.coerce.number().nullable().optional(),
  longitude: z.coerce.number().nullable().optional(),
  mapsLink: z.string().nullable().optional().or(z.literal('')),

  // Pricing
  pricing: pricingSchema,

  // Media
  photos: z.array(photoSchema).max(20, 'Maximum 20 photos allowed').nullable().optional(),
  videos: z.array(videoSchema).max(1, 'Maximum 1 video allowed').nullable().optional(),
  documents: z.array(documentSchema).nullable().optional(),

  // Amenities
  amenities: z.array(z.string()).nullable().optional(),

  // Contact
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number'),
  contactWhatsapp: z.string().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number').nullable().optional().or(z.literal('')),
  contactEmail: z.string().email('Please enter a valid email address').nullable().optional().or(z.literal('')),
  preferredContactHours: z.string().nullable().optional(),

  // Places
  nearbyPlaces: z.array(nearbyPlaceSchema).nullable().optional(),

  // Detail Subdocuments
  pgDetails: pgDetailsSchema.nullable().optional(),
  residentialDetails: residentialDetailsSchema.nullable().optional(),
  commercialDetails: commercialDetailsSchema.nullable().optional(),
};

// ─── Create Property Schema ───────────────────────────────────────────────────

const createPropertySchema = z.object(basePropertyFields).superRefine((data, ctx) => {
  if (data.category === 'pg') {
    if (!data.pgDetails || !data.pgDetails.roomConfigs || data.pgDetails.roomConfigs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pgDetails', 'roomConfigs'],
        message: 'At least one room configuration is required for PG listings',
      });
    }
  }

  if (data.category === 'residential_rental') {
    if (!data.residentialDetails) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['residentialDetails'],
        message: 'Residential property details (BHK, carpet area, bathrooms) are required',
      });
    } else {
      if (!data.residentialDetails.bhk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['residentialDetails', 'bhk'],
          message: 'BHK configuration is required',
        });
      }
      if (!data.residentialDetails.carpetAreaSqFt || Number(data.residentialDetails.carpetAreaSqFt) < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['residentialDetails', 'carpetAreaSqFt'],
          message: 'Valid carpet area is required',
        });
      }
    }
  }

  if (data.category === 'commercial') {
    if (!data.commercialDetails) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commercialDetails'],
        message: 'Commercial property details (subtype, carpet area, fitout) are required',
      });
    } else {
      if (!data.commercialDetails.commercialSubtype) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commercialDetails', 'commercialSubtype'],
          message: 'Commercial property subtype (office, retail, etc.) is required',
        });
      }
      if (!data.commercialDetails.carpetAreaSqFt || Number(data.commercialDetails.carpetAreaSqFt) < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commercialDetails', 'carpetAreaSqFt'],
          message: 'Valid carpet area is required',
        });
      }
    }
  }
});

// ─── Update Property Schema ───────────────────────────────────────────────────

const updatePropertySchema = z.object({
  ...basePropertyFields,
  title: basePropertyFields.title.optional(),
  city: basePropertyFields.city.optional(),
  area: basePropertyFields.area.optional(),
  address: basePropertyFields.address.optional(),
  contactPhone: basePropertyFields.contactPhone.optional(),
  pricing: basePropertyFields.pricing.partial().nullable().optional(),
  category: basePropertyFields.category.optional(),
  purpose: basePropertyFields.purpose.optional(),
  pgDetails: pgDetailsSchema.extend({
    roomConfigs: z.array(roomConfigSchema).optional(),
  }).partial().nullable().optional(),
  residentialDetails: residentialDetailsSchema.partial().nullable().optional(),
  commercialDetails: commercialDetailsSchema.partial().nullable().optional(),
  // Discard system / read-only fields if passed in update payload
  _id: z.any().optional(),
  id: z.any().optional(),
  __v: z.any().optional(),
  owner: z.any().optional(),
  status: z.string().optional(),
  createdAt: z.any().optional(),
  updatedAt: z.any().optional(),
  reviewedBy: z.any().optional(),
  reviewedAt: z.any().optional(),
  views: z.any().optional(),
  inquiries: z.any().optional(),
  wishlistCount: z.any().optional(),
  isVerified: z.any().optional(),
  verifiedAt: z.any().optional(),
  dataQualityScore: z.any().optional(),
  rejectionReason: z.any().optional(),
  correctionComments: z.any().optional(),
  moderationNotes: z.any().optional(),
  location: z.any().optional(),
});

// ─── Search Query Schema ──────────────────────────────────────────────────────

const propertyQuerySchema = z.object({
  category: z.enum(['pg', 'residential_rental', 'commercial', 'all']).optional(),
  purpose: z.enum(['rent', 'sale', 'all']).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  areas: z.string().optional(), // comma-separated
  q: z.string().optional(),
  minPrice: nullableCoercedNumber,
  maxPrice: nullableCoercedNumber,
  bhk: z.string().optional(),
  commercialSubtype: z.string().optional(),
  furnishingStatus: z.string().optional(),
  sharingType: z.string().optional(),
  gender: z.string().optional(),
  food: z.string().optional(),
  ac: z.string().optional(),
  isVerified: z.string().optional(),
  isFeatured: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius: z.coerce.number().optional(),
  sort: z.enum(['price_asc', 'price_desc', 'popular', 'distance', 'newest']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
  status: z.string().optional(),
});

// ─── Moderation Schema ────────────────────────────────────────────────────────

const reviewPropertySchema = z.object({
  action: z.enum(['approve', 'reject', 'request_correction', 'suspend', 'reinstate']),
  reason: z.string().optional(),
  comments: z.string().optional(),
});

module.exports = {
  createPropertySchema,
  updatePropertySchema,
  propertyQuerySchema,
  reviewPropertySchema,
  pgDetailsSchema,
  residentialDetailsSchema,
  commercialDetailsSchema,
};

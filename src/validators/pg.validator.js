const { z } = require('zod');

// ─── Shared helpers ────────────────────────────────────────────────────────────
const nullableCoercedNumber = z.preprocess((val) => {
  if (val === null || val === '') return null;
  if (val === undefined) return undefined;
  const num = Number(val);
  return isNaN(num) ? val : num;
}, z.number().min(0).nullable().optional());

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

const roomConfigSchema = z.object({
  shareType: z.enum(['single', 'double', 'triple', 'four', 'dormitory', 'studio']),
  rent: z.coerce.number().min(0, 'Rent must be a positive number'),
  depositAmount: nullableCoercedNumber,
  totalBeds: nullableCoercedNumber,
  availableBeds: nullableCoercedNumber,
  roomSize: z.string().optional(),
  furnitureIncluded: z.coerce.boolean().optional(),
  acIncluded: z.coerce.boolean().optional(),
  bathroomType: z.enum(['attached', 'shared', 'common-floor']).optional(),
  amenities: z.array(z.string()).optional(),
  _id: z.string().optional(),
});

const nearbyPlaceSchema = z.object({
  placeType: z.enum([
    'college', 'metro', 'bus_stop', 'hospital', 'it_park',
    'railway_station', 'shopping_mall', 'restaurant', 'bank_atm',
    'park', 'pharmacy', 'supermarket', 'other',
  ]),
  name: z.string(),
  distance: z.coerce.number(),
  walkTime: nullableCoercedNumber,
  placeId: z.string().optional(),
  address: z.string().optional(),
});

const mealTimingSchema = z.object({
  provided: z.coerce.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).optional();

const foodInfoSchema = z.object({
  provided: z.coerce.boolean().optional(),
  type: z.enum(['veg', 'nonveg', 'both']).optional(),
  includedInRent: z.coerce.boolean().optional(),
  mealCostPerMonth: nullableCoercedNumber,
  mealsPerDay: z.coerce.number().min(1).max(3).optional(),
  mealTimings: z.object({
    breakfast: mealTimingSchema,
    lunch: mealTimingSchema,
    dinner: mealTimingSchema,
  }).optional(),
  kitchenAccess: z.coerce.boolean().optional(),
  kitchenHours: z.string().optional(),
  messType: z.enum(['in-house', 'outsourced', 'tiffin-service', 'self']).optional(),
}).optional();

const rulesSchema = z.object({
  smokingAllowed: z.coerce.boolean().optional(),
  alcoholAllowed: z.coerce.boolean().optional(),
  petsAllowed: z.coerce.boolean().optional(),
  guestsAllowed: z.coerce.boolean().optional(),
  visitorPolicy: z.enum(['not_allowed', 'lobby_only', 'room_allowed']).optional(),
  curfewTime: z.string().optional(),
  cookingAllowed: z.coerce.boolean().optional(),
  nonVegAllowed: z.coerce.boolean().optional(),
  customRules: z.array(z.string()).optional(),
}).optional();

const photoSchema = z.object({
  url: z.string().url('Enter a valid photo URL'),
  publicId: z.string(),
  caption: z.string().optional(),
  isMain: z.boolean().default(false),
  order: z.number().optional(),
  _id: z.string().optional(),
});

const videoSchema = z.object({
  url: z.string().url('Enter a valid video URL'),
  publicId: z.string(),
  thumbnailUrl: z.string().optional(),
  title: z.string().max(150).optional(),
  duration: z.number().optional(),
  order: z.number().optional(),
  _id: z.string().optional(),
});

// ─── Create Schema ─────────────────────────────────────────────────────────────
const createPGSchema = z.object({
  // Identification
  name: z.string().min(3, 'PG name must be at least 3 characters').max(200),
  description: z.string().max(2000).optional(),
  propertyType: z.enum(['PG', 'Hostel', 'Co-living', 'Apartment', 'Independent House', 'Other']).optional(),
  propertyAge: nullableCoercedNumber,

  // Location
  city: z.string().min(2, 'City is required').max(100),
  area: z.string().min(2, 'Area is required').max(100),
  address: z.string().min(5, 'Address is required').max(500),
  fullAddress: z.string().optional(),
  landmark: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  googlePlaceId: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  mapsLink: z.string().url('Enter a valid Google Maps URL').optional().or(z.literal('')),

  // Policies
  securityDeposit: nullableCoercedNumber,
  noticePeriod: nullableCoercedNumber,
  minStay: nullableCoercedNumber,
  maxStay: nullableCoercedNumber,
  yearlyPricing: nullableCoercedNumber,
  monthlyPricing: nullableCoercedNumber,
  floors: nullableCoercedNumber,
  totalRooms: nullableCoercedNumber,

  // Targeting
  gender: z.enum(['male', 'female', 'any']).default('any'),
  preferredTenants: z.array(
    z.enum(['student', 'working_professional', 'family', 'any'])
  ).optional(),

  // Legacy food (kept for search-compat)
  food: z.enum(['veg', 'nonveg', 'both', 'none']).default('none'),
  foodIncluded: z.coerce.boolean().default(false),
  // Structured food info
  foodInfo: foodInfoSchema,

  // Amenities
  ac: z.coerce.boolean().default(false),
  facilities: z.array(z.string()).default([]),

  // Rules
  rules: rulesSchema,

  // Room configs — at least one required
  roomConfigs: z.array(roomConfigSchema).min(1, 'At least one room configuration is required'),

  // Media
  photos: z.array(photoSchema).optional(),
  videos: z.array(videoSchema).max(3, 'Maximum 3 videos allowed').optional(),

  // Contact
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit phone number'),
  contactWhatsapp: z.string().regex(/^[6-9]\d{9}$/).optional().or(z.literal('')),

  // Availability
  isAvailable: z.coerce.boolean().default(true),
  availableRooms: nullableCoercedNumber,

  // Nearby
  nearbyPlaces: z.array(nearbyPlaceSchema).optional(),

  // Data quality — optional, overridable
  dataQualityScore: z.coerce.number().min(1).max(5).nullable().optional(),
});

const updatePGSchema = createPGSchema.partial();

// ─── Search Schema ─────────────────────────────────────────────────────────────
const pgSearchSchema = z.object({
  city: z.string().optional(),
  area: z.string().optional(),
  areas: z.string().optional(),        // comma-separated multi-area
  q: z.string().optional(),
  food: z.enum(['veg', 'nonveg', 'both', 'none']).optional(),
  ac: z.enum(['true', 'false']).optional(),
  gender: z.enum(['male', 'female', 'any']).optional(),
  preferredTenants: z.string().optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  sharingType: z.enum(['single', 'double', 'triple', 'four', 'dormitory', 'studio']).optional(),
  propertyType: z.string().optional(),
  isVerified: z.enum(['true', 'false']).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius: z.coerce.number().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(12),
  sort: z.enum(['newest', 'rent_asc', 'rent_desc', 'popular', 'distance']).default('newest'),
});

module.exports = { createPGSchema, updatePGSchema, pgSearchSchema };

const { z } = require('zod');

// ─── Reusable Schemas ─────────────────────────────────────────────────────────

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

const timeString = z
  .string()
  .min(1, 'Time is required')
  .regex(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(:[0-5][0-9])?$/, 'Time must be in HH:mm format (e.g., 14:30)')
  .transform((val) => {
    const parts = val.split(':');
    const h = parts[0].padStart(2, '0');
    const m = parts[1] || '00';
    return `${h}:${m}`;
  });


const phoneNumber = z
  .string()
  .regex(/^[6-9]\d{9}$/, 'Please enter a valid Indian mobile number');

// ─── Area ─────────────────────────────────────────────────────────────────────

const createAreaSchema = z.object({
  city: objectId,
  name: z.string().min(1, 'Area name is required').max(100).trim(),
  description: z.string().max(300).trim().optional(),
  isActive: z.boolean().optional().default(true),
  order: z.number().int().min(0).optional().default(99),
});

const updateAreaSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(300).trim().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

// ─── Cuisine ──────────────────────────────────────────────────────────────────

const createCuisineSchema = z.object({
  name: z.string().min(1, 'Cuisine name is required').max(100).trim(),
  description: z.string().max(300).trim().optional(),
  icon: z.string().trim().optional(),
  isActive: z.boolean().optional().default(true),
  order: z.number().int().min(0).optional().default(99),
});

const updateCuisineSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(300).trim().optional(),
  icon: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

// ─── Hotel Registration Request ───────────────────────────────────────────────

const hotelRegistrationRequestSchema = z.object({
  ownerName: z.string().min(1, 'Owner name is required').max(100).trim(),
  mobileNumber: phoneNumber,
  hotelName: z.string().min(1, 'Hotel name is required').max(200).trim(),
  cityId: objectId.optional(),
  city: z.string().min(1, 'City is required').trim(),
  areaId: objectId.optional(),
  area: z.string().trim().optional(),
  address: z.string().min(1, 'Address is required').max(500).trim(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// ─── Hotel (Admin create / Owner update) ──────────────────────────────────────

const createHotelSchema = z.object({
  name: z.string().min(1, 'Hotel name is required').max(200).trim(),
  description: z.string().max(2000).trim().optional(),
  tagline: z.string().max(200).trim().optional(),
  cityId: objectId,
  city: z.string().min(1, 'City is required').trim(),
  areaId: objectId.optional(),
  area: z.string().min(1, 'Area is required').trim(),
  address: z.string().min(1, 'Address is required').max(500).trim(),
  fullAddress: z.string().max(1000).trim().optional(),
  landmark: z.string().max(200).trim().optional(),
  state: z.string().max(100).trim().optional(),
  postalCode: z.string().max(10).trim().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  googlePlaceId: z.string().trim().optional(),
  googleMapsLink: z.string().url('Invalid Google Maps URL').optional().or(z.literal('')),
  contactPhone: z.string().min(1, 'Contact phone is required').trim(),
  contactEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  contactWhatsapp: z.string().trim().optional(),
  website: z.string().url('Invalid website URL').optional().or(z.literal('')),
  cuisine: z.array(z.string()).optional().default([]),
  foodType: z.enum(['veg', 'nonveg', 'both']).optional().default('both'),
  seatingCapacity: z.number().int().min(0).optional(),
  facilities: z.array(z.string()).optional().default([]),
  parkingAvailable: z.boolean().optional().default(false),
  priceRange: z
    .object({
      min: z.number().min(0),
      max: z.number().min(0),
    })
    .optional(),
  owner: objectId, // required for admin direct creation
});

const updateHotelSchema = createHotelSchema
  .omit({ owner: true })
  .partial();

// ─── Buffet ───────────────────────────────────────────────────────────────────

const createBuffetSchema = z.object({
  name: z.string().min(1, 'Buffet name is required').max(200).trim(),
  description: z.string().max(1000).trim().optional().nullable().or(z.literal('')),
  type: z.enum(['lunch', 'dinner', 'brunch', 'breakfast', 'special', 'family', 'festival', 'unlimited']).optional().default('lunch'),
  foodType: z.enum(['veg', 'nonveg', 'both']).optional().default('both'),
  date: z.union([z.string().min(1, 'Date is required'), z.date()]),
  startTime: timeString,
  endTime: timeString,
  pricePerPerson: z.union([z.number().min(0), z.string()]).transform((v) => Number(v)),
  maxCapacity: z.union([z.number().int().min(0), z.string(), z.null()]).optional().transform((v) => (v ? Number(v) : null)),
  cuisine: z.union([z.array(z.string()), z.string()]).optional().transform((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split(',').map((c) => c.trim()).filter(Boolean);
    return [];
  }),
});

const updateBuffetSchema = createBuffetSchema.partial().passthrough();


// ─── Buffet Menu ──────────────────────────────────────────────────────────────

const menuItemSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1, 'Item name is required').max(150).trim(),
  description: z.string().max(300).trim().optional(),
  isVeg: z.boolean().optional().default(true),
  isSpicy: z.boolean().optional().default(false),
  isSignature: z.boolean().optional().default(false),
  isAvailable: z.boolean().optional().default(true),
  order: z.number().int().min(0).optional().default(99),
  image: z
    .object({
      url: z.string().nullable().optional(),
      publicId: z.string().nullable().optional(),
    })
    .optional()
    .nullable(),
});

const menuSectionSchema = z.object({
  _id: z.string().optional(),
  sectionName: z.string().min(1, 'Section name is required').max(100).trim(),
  description: z.string().max(300).trim().optional(),
  order: z.number().int().min(0).optional().default(99),
  icon: z.string().trim().optional(),
  items: z.array(menuItemSchema).optional().default([]),
});


const createMenuSchema = z.object({
  sections: z.array(menuSectionSchema).min(1, 'At least one menu section is required'),
});

// ─── Reservation ──────────────────────────────────────────────────────────────

const createReservationSchema = z.object({
  partySize: z.number().int().min(1).max(50).optional().default(1),
  specialRequests: z.string().max(500).trim().optional(),
});

const cancelReservationSchema = z.object({
  cancellationReason: z.string().max(500).trim().optional(),
});

// ─── Promotion ────────────────────────────────────────────────────────────────

const createPromotionSchema = z.object({
  type: z.enum(['early_bird', 'couple', 'family', 'pginfo_exclusive', 'group', 'custom']),
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(500).trim().optional(),
  discountType: z.enum(['flat', 'percentage']),
  discountValue: z.number().min(0),
  originalPrice: z.number().min(0),
  finalPrice: z.number().min(0),
  minPartySize: z.number().int().min(1).optional().default(1),
  maxPartySize: z.number().int().min(1).optional().nullable(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional().nullable(),
  maxRedemptions: z.number().int().min(1).optional().nullable(),
});

// ─── Review ───────────────────────────────────────────────────────────────────

const createReviewSchema = z.object({
  rating: z.number().min(1).max(5),
  review: z.string().max(2000).trim().optional(),
  foodQualityRating: z.number().min(1).max(5).optional().nullable(),
  valueRating: z.number().min(1).max(5).optional().nullable(),
  serviceRating: z.number().min(1).max(5).optional().nullable(),
  ambianceRating: z.number().min(1).max(5).optional().nullable(),
});

// ─── Weekly Plan ──────────────────────────────────────────────────────────────

const weeklyPlanBuffetSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  type: z.enum(['lunch', 'dinner', 'brunch', 'breakfast', 'special', 'family', 'festival', 'unlimited']),
  foodType: z.enum(['veg', 'nonveg', 'both']).optional().default('both'),
  date: z.string().min(1),
  startTime: timeString,
  endTime: timeString,
  pricePerPerson: z.number().min(0),
  maxCapacity: z.number().int().min(1).optional().nullable(),
  cuisine: z.array(z.string()).optional().default([]),
});

const createWeeklyPlanSchema = z.object({
  weekStartDate: z.string().min(1, 'Week start date is required'),
  weekEndDate: z.string().min(1, 'Week end date is required'),
  buffets: z.array(weeklyPlanBuffetSchema).min(1, 'At least one buffet is required'),
});

// ─── Admin: reject/approve schemas ───────────────────────────────────────────

const rejectSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required').max(1000).trim(),
});

const approveRegistrationSchema = z.object({
  adminNotes: z.string().max(500).trim().optional(),
});

module.exports = {
  createAreaSchema,
  updateAreaSchema,
  createCuisineSchema,
  updateCuisineSchema,
  hotelRegistrationRequestSchema,
  createHotelSchema,
  updateHotelSchema,
  createBuffetSchema,
  updateBuffetSchema,
  createMenuSchema,
  createReservationSchema,
  cancelReservationSchema,
  createPromotionSchema,
  createReviewSchema,
  createWeeklyPlanSchema,
  rejectSchema,
  approveRegistrationSchema,
};

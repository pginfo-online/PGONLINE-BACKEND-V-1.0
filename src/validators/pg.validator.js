const { z } = require('zod');

const createPGSchema = z.object({
  name: z.string().min(3, 'PG name must be at least 3 characters').max(200),
  description: z.string().max(1000).optional(),
  city: z.enum(['Pune', 'Mumbai', 'Delhi'], { required_error: 'City is required' }),
  area: z.string().min(2, 'Area is required').max(100),
  address: z.string().min(5, 'Address is required').max(500),
  mapsLink: z.string().url('Enter a valid Google Maps URL').optional().or(z.literal('')),
  rent: z.object({
    single: z.coerce.number().min(0).optional(),
    double: z.coerce.number().min(0).optional(),
    triple: z.coerce.number().min(0).optional(),
  }).optional(),
  food: z.enum(['veg', 'nonveg', 'both', 'none']).default('none'),
  foodIncluded: z.coerce.boolean().default(false),
  ac: z.coerce.boolean().default(false),
  gender: z.enum(['male', 'female', 'any']).default('any'),
  facilities: z.array(z.string()).default([]),
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid phone number'),
  contactWhatsapp: z.string().regex(/^[6-9]\d{9}$/).optional().or(z.literal('')),
  isAvailable: z.coerce.boolean().default(true),
  availableRooms: z.coerce.number().min(0).default(0),
  photos: z.array(
    z.object({
      url: z.string().url('Enter a valid photo URL'),
      publicId: z.string(),
      isMain: z.boolean().default(false),
      _id: z.string().optional(),
    })
  ).optional(),
  videos: z.array(
    z.object({
      url: z.string().url('Enter a valid video URL'),
      publicId: z.string(),
      _id: z.string().optional(),
    })
  ).optional(),
});

const updatePGSchema = createPGSchema.partial();

const pgSearchSchema = z.object({
  city: z.enum(['Pune', 'Mumbai', 'Delhi']).optional(),
  area: z.string().optional(),
  q: z.string().optional(),
  food: z.enum(['veg', 'nonveg', 'both', 'none']).optional(),
  ac: z.enum(['true', 'false']).optional(),
  gender: z.enum(['male', 'female', 'any']).optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  sharingType: z.enum(['single', 'double', 'triple']).optional(),
  isVerified: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(12),
  sort: z.enum(['newest', 'rent_asc', 'rent_desc', 'popular']).default('newest'),
});

module.exports = { createPGSchema, updatePGSchema, pgSearchSchema };

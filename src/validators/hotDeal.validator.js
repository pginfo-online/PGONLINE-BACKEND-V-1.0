const { z } = require('zod');

// ─── Shared ───────────────────────────────────────────────────────────────────
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

const booleanTransform = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return undefined;
    return v === true || v === 'true' || v === '1';
  });

const numberTransform = (minVal = 0, defaultVal = undefined) =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return defaultVal;
      const parsed = Number(v);
      return isNaN(parsed) ? defaultVal : parsed;
    });

const arrayTransform = (itemSchema = z.string()) =>
  z
    .union([z.array(itemSchema), z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return [];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : [v];
        } catch (_) {
          return v.includes(',') ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v];
        }
      }
      return [];
    });

// ─── HotDeal Category ─────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(80).trim(),
  displayName: z.string().max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
  icon: z.string().trim().optional().default('🏷️'),
  color: z.string().trim().optional().default('#FF4B2B'),
  isActive: booleanTransform.default(true),
  isFeatured: booleanTransform.default(false),
  order: numberTransform(0, 99),
  seoDescription: z.string().max(160).trim().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  displayName: z.string().max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
  icon: z.string().trim().optional(),
  color: z.string().trim().optional(),
  isActive: booleanTransform,
  isFeatured: booleanTransform,
  order: numberTransform(0, undefined),
  seoDescription: z.string().max(160).trim().optional(),
}).passthrough();

// ─── HotDeal ──────────────────────────────────────────────────────────────────

const createDealSchema = z.object({
  // Identity
  title: z.string().min(1, 'Title is required').max(200).trim(),
  shortDescription: z.string().max(300).trim().optional(),
  description: z.string().max(5000).trim().optional(),

  // Category
  category: objectId,

  // Provider
  providerName: z.string().min(1, 'Provider name is required').max(200).trim(),
  providerWebsite: z.string().url('Invalid website URL').optional().or(z.literal('')).or(z.literal(null)),
  providerContact: z.string().trim().optional(),

  // Pricing
  originalPrice: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0, 'Original price must be >= 0')),
  dealPrice: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0, 'Deal price must be >= 0')),
  discountPercent: numberTransform(0, undefined),
  currency: z.string().trim().optional().default('INR'),

  // Coupon
  couponType: z.enum(['none', 'code', 'scratch']).optional().default('none'),
  couponCode: z.string().trim().optional().nullable(),
  couponNote: z.string().trim().optional().nullable(),

  // Deal Link
  dealUrl: z.string().url('Invalid deal URL').optional().or(z.literal('')).or(z.literal(null)),
  ctaLabel: z.string().trim().optional().default('Get Deal'),

  // Schedule
  startDate: z.union([z.string().min(1, 'Start date required'), z.date()]),
  endDate: z.union([z.string().min(1, 'End date required'), z.date()]),

  // Availability
  availabilityType: z.enum(['unlimited', 'limited']).optional().default('unlimited'),
  totalQuantity: numberTransform(1, null),

  // Location targeting (optional)
  cityIds: arrayTransform(objectId),
  areaIds: arrayTransform(objectId),
  cityNames: arrayTransform(z.string().trim()),
  areaNames: arrayTransform(z.string().trim()),

  // Rich content
  termsAndConditions: z.string().trim().optional().nullable(),
  howToRedeem: z.string().trim().optional().nullable(),
  highlights: arrayTransform(z.string().trim()),

  // Settings
  isFeatured: booleanTransform.default(false),
  featuredUntil: z.string().optional().nullable(),
  status: z.enum(['draft', 'scheduled', 'live', 'paused', 'expired']).optional().default('draft'),
  internalNote: z.string().trim().optional().nullable(),
  tags: arrayTransform(z.string().trim().toLowerCase()),
});

const updateDealSchema = createDealSchema.partial().passthrough();

const changeDealStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'live', 'paused', 'expired']),
  reason: z.string().trim().optional(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  createDealSchema,
  updateDealSchema,
  changeDealStatusSchema,
};

const { z } = require('zod');

const datasetSchema = z.enum(['pgs', 'users', 'leads', 'rent']);
const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

// Schema for direct export query parameters
const exportQuerySchema = z.object({
  dataset: datasetSchema.default('pgs'),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  city: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
  isVerified: z.enum(['true', 'false']).optional().or(z.boolean().optional()),
  search: z.string().trim().max(200).optional(),
  billingYear: z.coerce.number().int().min(2000).max(2100).optional(),
  billingMonth: z.coerce.number().int().min(1).max(12).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine((data) => !data.startDate || !data.endDate || new Date(data.startDate) <= new Date(data.endDate), {
  message: 'startDate must be before or equal to endDate',
  path: ['startDate'],
});

// Schema for background export job creation (filters can be passed in request body)
const initiateJobSchema = z.object({
  dataset: datasetSchema.default('pgs'),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  city: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
  isVerified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  search: z.string().trim().max(200).optional(),
  billingYear: z.coerce.number().int().min(2000).max(2100).optional(),
  billingMonth: z.coerce.number().int().min(1).max(12).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine((data) => !data.startDate || !data.endDate || new Date(data.startDate) <= new Date(data.endDate), {
  message: 'startDate must be before or equal to endDate',
  path: ['startDate'],
});

module.exports = {
  exportQuerySchema,
  initiateJobSchema,
};

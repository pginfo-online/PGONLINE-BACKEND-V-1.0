const { z } = require('zod');

// Schema for direct export query parameters
const exportQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  city: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
  isVerified: z.enum(['true', 'false']).optional().or(z.boolean().optional()),
  search: z.string().trim().max(200).optional(),
  token: z.string().optional(), // JWT token can be passed as query param for direct download
});

// Schema for background export job creation (filters can be passed in request body)
const initiateJobSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  city: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
  isVerified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  search: z.string().trim().max(200).optional(),
});

module.exports = {
  exportQuerySchema,
  initiateJobSchema,
};

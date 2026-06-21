const { z } = require('zod');

const createVisitSchema = z.object({
  pgId: z.string().min(1, 'PG ID is required'),
  scheduledDate: z.string().min(1, 'Date is required'),
  scheduledTime: z.string().min(1, 'Time is required'),
  message: z.string().max(500).optional(),
});

const updateVisitStatusSchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'completed'], {
    required_error: 'Status is required',
  }),
  ownerNote: z.string().max(500).optional(),
});

module.exports = { createVisitSchema, updateVisitStatusSchema };

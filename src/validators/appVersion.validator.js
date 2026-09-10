const { z } = require('zod');

const checkVersionSchema = z.object({
  platform: z.enum(['android', 'ios'], {
    errorMap: () => ({ message: "Platform must be 'android' or 'ios'" }),
  }),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver format (e.g. 1.0.0)'),
  deviceId: z.string().optional(),
});

const createVersionSchema = z.object({
  platform: z.enum(['android', 'ios'], {
    errorMap: () => ({ message: "Platform must be 'android' or 'ios'" }),
  }),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver format (e.g. 1.0.0)'),
  versionCode: z.number().int().min(0).optional(),
  updateLink: z.string().url('Invalid update URL').optional().or(z.literal('')),
  minVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Minimum version must follow semver format (e.g. 1.0.0)'),
  priority: z.enum(['optional', 'recommended', 'important', 'critical'], {
    errorMap: () => ({ message: 'Invalid update priority' }),
  }),
  title: z.string().min(2, 'Title must be at least 2 characters').max(100),
  description: z.string().min(5, 'Description must be at least 5 characters').max(500),
  releaseNotes: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
  maintenanceMode: z.boolean().optional().default(false),
  maintenanceMessage: z.string().max(200).optional(),
  rolloutPercentage: z.number().min(0).max(100).optional().default(100),
  scheduledRelease: z.string().optional().nullable().or(z.literal('')),
});

const updateVersionSchema = createVersionSchema.partial();

module.exports = {
  checkVersionSchema,
  createVersionSchema,
  updateVersionSchema,
};

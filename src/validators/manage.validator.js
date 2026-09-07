const { z } = require('zod');

// Building validation schemas
const createBuildingSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 chars').max(200),
  description: z.string().max(500).optional(),
  totalFloors: z.number().int().min(1, 'At least 1 floor').default(1),
  status: z.enum(['active', 'inactive', 'under_construction', 'maintenance']).optional(),
  address: z.string().optional(),
});

const updateBuildingSchema = createBuildingSchema.partial();

// Floor validation schemas
const createFloorSchema = z.object({
  floorNumber: z.number().int('Floor number must be an integer'),
  name: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional(),
});

const updateFloorSchema = createFloorSchema.partial();

// Room validation schemas
const createRoomSchema = z.object({
  roomNumber: z.string().min(1, 'Room number required').max(20),
  shareType: z.enum(['single', 'double', 'triple', 'four', 'dormitory']),
  totalBeds: z.number().int().min(1, 'Must have at least 1 bed').max(12),
  rentPerBed: z.number().min(0, 'Rent cannot be negative').optional(),
  status: z.enum(['active', 'inactive', 'maintenance', 'renovation']).optional(),
  amenities: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
});

const updateRoomSchema = createRoomSchema.partial();

// Bed validation schemas
const updateBedSchema = z.object({
  bedLabel: z.string().max(10).optional(),
  status: z.enum(['vacant', 'occupied', 'reserved', 'maintenance']).optional(),
  rentOverride: z.number().min(0).nullable().optional(),
  notes: z.string().max(300).optional(),
});

// Tenant validation schemas
const addTenantSchema = z.object({
  name: z.string().min(2, 'Name required').max(100),
  email: z.string().email('Invalid email').optional().nullable(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian mobile number'),
  gender: z.enum(['male', 'female', 'other']).optional(),
  dateOfBirth: z.string().optional().nullable(),
  joinDate: z.string().min(1, 'Join date required'),
  monthlyRent: z.number().min(0, 'Rent required'),
  securityDeposit: z.number().min(0).optional(),
  depositStatus: z.enum(['pending', 'received', 'refunded', 'partial']).optional(),
  foodPreference: z.enum(['veg', 'nonveg', 'eggetarian', 'none']).optional(),
  notes: z.string().max(1000).optional(),
});

const updateTenantSchema = addTenantSchema.partial();

// Staff validation schemas
const addStaffSchema = z.object({
  name: z.string().min(2, 'Name required').max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number'),
  email: z.string().email().optional().nullable(),
  role: z.enum([
    'manager', 'property_manager', 'security', 'cleaner',
    'cook', 'electrician', 'plumber', 'gardener', 'driver', 'other',
  ]),
  customRole: z.string().optional(),
  joiningDate: z.string().min(1, 'Joining date required'),
  salary: z.number().min(0).optional(),
  salaryFrequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  address: z.string().optional(),
});

const updateStaffSchema = addStaffSchema.partial();

// Rent validation schemas
const generateRentSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  dueDayOfMonth: z.number().int().min(1).max(28).optional(),
});

const markRentPaidSchema = z.object({
  amount: z.number().min(1, 'Amount required'),
  method: z.enum(['online', 'cash', 'upi', 'bank_transfer', 'cheque', 'other']).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

// Expense validation schemas
const addExpenseSchema = z.object({
  category: z.enum([
    'maintenance', 'utilities', 'staff_salary', 'food', 'cleaning',
    'security', 'internet', 'rent', 'furniture', 'equipment',
    'taxes', 'insurance', 'marketing', 'other',
  ]),
  subcategory: z.string().optional(),
  description: z.string().min(2).max(500),
  amount: z.number().min(0),
  expenseDate: z.string().min(1),
  vendor: z.string().optional(),
  vendorPhone: z.string().optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']).optional(),
  referenceNumber: z.string().optional(),
  isRecurring: z.boolean().optional(),
  notes: z.string().optional(),
});

// Hiring validation schemas
const createJobPostSchema = z.object({
  title: z.string().min(2, 'Job title must be at least 2 characters').max(200),
  role: z.enum(['cook', 'cleaner', 'security', 'manager', 'electrician', 'plumber', 'other']),
  customRole: z.string().optional(),
  description: z.string().min(3, 'Description must be at least 3 characters').max(2000),
  requirements: z.string().max(1000).optional(),
  salaryMin: z.number().min(0).optional(),
  salaryMax: z.number().min(0).optional(),
  salaryFrequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  genderPreference: z.enum(['male', 'female', 'any']).optional(),
  experienceRequired: z.number().min(0).optional(),
  accommodation: z.boolean().optional(),
  food: z.boolean().optional(),
  workingHours: z.string().optional(),
  shiftType: z.enum(['full_time', 'part_time', 'contract']).optional(),
  bannerImage: z.string().optional().or(z.literal('')),
});

const applyJobSchema = z.object({
  applicantName: z.string().min(2).max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number'),
  email: z.string().email().optional().nullable(),
  experience: z.number().min(0).optional(),
  coverLetter: z.string().max(2000).optional(),
  currentLocation: z.string().optional(),
});

// Agreement validation schemas
const createAgreementSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  monthlyRent: z.number().min(0, 'Monthly rent required').optional(),
  securityDeposit: z.number().min(0).optional(),
  noticePeriodDays: z.number().min(0).optional(),
  rentDueDay: z.number().int().min(1).max(28).optional(),
  terms: z.string().max(5000).optional(),
  rules: z.object({
    guestPolicy: z.string().optional(),
    foodPolicy: z.string().optional(),
    smokingAllowed: z.boolean().optional(),
    petsAllowed: z.boolean().optional(),
    other: z.string().optional(),
  }).optional(),
});

const updateAgreementSchema = z.object({
  terms: z.string().max(5000).optional(),
  rules: z.object({
    guestPolicy: z.string().optional(),
    foodPolicy: z.string().optional(),
    smokingAllowed: z.boolean().optional(),
    petsAllowed: z.boolean().optional(),
    other: z.string().optional(),
  }).optional(),
  status: z.enum(['draft', 'active', 'expired', 'terminated', 'renewed']).optional(),
  terminationReason: z.string().max(500).optional(),
});

module.exports = {
  createBuildingSchema, updateBuildingSchema,
  createFloorSchema, updateFloorSchema,
  createRoomSchema, updateRoomSchema, updateBedSchema,
  addTenantSchema, updateTenantSchema,
  addStaffSchema, updateStaffSchema,
  generateRentSchema, markRentPaidSchema,
  addExpenseSchema,
  createJobPostSchema, applyJobSchema,
  createAgreementSchema, updateAgreementSchema,
};

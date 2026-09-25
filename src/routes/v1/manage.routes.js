const express = require('express');
const router  = express.Router();

const { protect, authorize, optionalAuth } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const validators = require('../../validators/manage.validator');

// Controllers
const propertyController  = require('../../controllers/manage/property.controller');
const tenantController    = require('../../controllers/manage/tenant.controller');
const staffController     = require('../../controllers/manage/staff.controller');
const rentController      = require('../../controllers/manage/rent.controller');
const paymentController   = require('../../controllers/manage/payment.controller');
const agreementController = require('../../controllers/manage/agreement.controller');
const expenseController   = require('../../controllers/manage/expense.controller');
const dashboardController = require('../../controllers/manage/dashboard.controller');
const hiringController    = require('../../controllers/manage/hiring.controller');
const mealController      = require('../../controllers/manage/meal.controller');

// ─── Public / Open Hiring Routes ──────────────────────────────────────────────
router.get('/jobs/public', hiringController.getPublicJobs);
router.get('/jobs/public/:id', hiringController.getPublicJobDetails);
router.post('/jobs/public/:id/apply', optionalAuth, validate(validators.applyJobSchema), hiringController.applyForJob);

// ─── Razorpay Webhook (Public POST from Razorpay servers) ─────────────────────
router.post('/payments/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBody = req.body.toString('utf8');
  next();
}, paymentController.handleWebhook);

// ─── Protected Routes (Requires Auth) ──────────────────────────────────────────
router.use(protect);

// ─── Tenant Self Services (Mobile Tenant Mode) ────────────────────────────────
router.get('/my-tenancy', tenantController.getMyTenancy);
router.get('/my-rent-records', rentController.getMyRentRecords);
router.get('/my-pg-meals', mealController.getMyPGMeals);
router.get('/rent/:id/receipt', rentController.getReceipt);

// ─── Owner / Property Manager Routes ──────────────────────────────────────────
const ownerOrAdmin = authorize('owner', 'admin', 'property_manager');

// ─── Dashboard & Analytics ────────────────────────────────────────────────────
router.get('/dashboard', ownerOrAdmin, dashboardController.getDashboardSummary);
router.get('/pgs/:pgId/dashboard', ownerOrAdmin, dashboardController.getPropertyDashboard);
router.get('/reports/financial', ownerOrAdmin, dashboardController.getFinancialReport);

// ─── Room-First Property APIs ─────────────────────────────────────────────────
router.get('/pgs/:pgId/rooms', ownerOrAdmin, propertyController.getPGRooms);
router.post('/pgs/:pgId/rooms', ownerOrAdmin, validate(validators.createPGRoomSchema), propertyController.createPGRoom);

// ─── Building Hierarchy APIs (Traditional / Detailed View) ───────────────────
router.post('/pgs/:pgId/buildings', ownerOrAdmin, validate(validators.createBuildingSchema), propertyController.createBuilding);
router.get('/pgs/:pgId/buildings', ownerOrAdmin, propertyController.getBuildings);
router.get('/buildings/:id', ownerOrAdmin, propertyController.getBuilding);
router.put('/buildings/:id', ownerOrAdmin, validate(validators.updateBuildingSchema), propertyController.updateBuilding);
router.delete('/buildings/:id', ownerOrAdmin, propertyController.deleteBuilding);

// ─── Floor APIs ───────────────────────────────────────────────────────────────
router.post('/buildings/:buildingId/floors', ownerOrAdmin, validate(validators.createFloorSchema), propertyController.createFloor);
router.get('/buildings/:buildingId/floors', ownerOrAdmin, propertyController.getFloors);
router.put('/floors/:id', ownerOrAdmin, validate(validators.updateFloorSchema), propertyController.updateFloor);
router.delete('/floors/:id', ownerOrAdmin, propertyController.deleteFloor);

// ─── Room APIs (Standard / Direct) ────────────────────────────────────────────
router.post('/floors/:floorId/rooms', ownerOrAdmin, validate(validators.createRoomSchema), propertyController.createRoom);
router.get('/floors/:floorId/rooms', ownerOrAdmin, propertyController.getRooms);
router.get('/rooms/:id', ownerOrAdmin, propertyController.getRoom);
router.put('/rooms/:id', ownerOrAdmin, validate(validators.updateRoomSchema), propertyController.updateRoom);
router.delete('/rooms/:id', ownerOrAdmin, propertyController.deleteRoom);

// ─── Bed APIs & Availability Overview ─────────────────────────────────────────
router.put('/beds/:id', ownerOrAdmin, validate(validators.updateBedSchema), propertyController.updateBed);
router.get('/rooms/:roomId/beds', ownerOrAdmin, propertyController.getBeds);
router.get('/pgs/:pgId/availability', ownerOrAdmin, propertyController.getAvailability);
router.get('/pgs/:pgId/hierarchy', ownerOrAdmin, propertyController.getPropertyHierarchy);

// ─── Tenant Management APIs ───────────────────────────────────────────────────
router.get('/tenants/search-existing', ownerOrAdmin, tenantController.searchExistingTenants);
router.get('/pgs/:pgId/tenants', ownerOrAdmin, tenantController.getTenants);
router.post('/pgs/:pgId/tenants', ownerOrAdmin, validate(validators.addTenantSchema), tenantController.addTenant);
router.get('/tenants/:id', ownerOrAdmin, tenantController.getTenant);
router.put('/tenants/:id', ownerOrAdmin, validate(validators.updateTenantSchema), tenantController.updateTenant);
router.post('/tenants/:tenantId/assign-bed', ownerOrAdmin, tenantController.assignBed);
router.post('/tenants/:id/vacate', ownerOrAdmin, tenantController.vacateTenant);

// ─── Staff Management APIs ────────────────────────────────────────────────────
router.get('/pgs/:pgId/staff', ownerOrAdmin, staffController.getStaff);
router.post('/pgs/:pgId/staff', ownerOrAdmin, validate(validators.addStaffSchema), staffController.addStaff);
router.get('/staff/:id', ownerOrAdmin, staffController.getStaffMember);
router.put('/staff/:id', ownerOrAdmin, validate(validators.updateStaffSchema), staffController.updateStaff);
router.put('/staff/:id/permissions', ownerOrAdmin, staffController.updatePermissions);
router.delete('/staff/:id', ownerOrAdmin, staffController.removeStaff);

// ─── Rent Management APIs ─────────────────────────────────────────────────────
router.post('/pgs/:pgId/rent/generate', ownerOrAdmin, validate(validators.generateRentSchema), rentController.generateRent);
router.get('/pgs/:pgId/rent', ownerOrAdmin, rentController.getRentRecords);
router.get('/pgs/:pgId/rent/summary', ownerOrAdmin, rentController.getRentSummary);
router.get('/tenants/:tenantId/rent', ownerOrAdmin, rentController.getTenantRentRecords);
router.get('/rent/:id', ownerOrAdmin, rentController.getRentRecord);
router.put('/rent/:id', ownerOrAdmin, validate(validators.updateRentRecordSchema), rentController.updateRentRecord);
router.delete('/rent/:id', ownerOrAdmin, rentController.deleteRentRecord);
router.post('/rent/:id/mark-paid', ownerOrAdmin, validate(validators.markRentPaidSchema), rentController.markRentPaid);
router.post('/rent/:id/send-reminder', ownerOrAdmin, validate(validators.sendReminderSchema), rentController.sendRentReminder);
router.post('/rent/:id/payment-link', ownerOrAdmin, rentController.createPaymentLink);
router.get('/rent/:id/reminders', ownerOrAdmin, rentController.getReminderHistory);
router.get('/pgs/:pgId/rent-settings', ownerOrAdmin, rentController.getRentSettings);
router.put('/pgs/:pgId/rent-settings', ownerOrAdmin, rentController.updateRentSettings);

// ─── Payments & Razorpay APIs ─────────────────────────────────────────────────
router.post('/payments/create-order', paymentController.createOrder); // both tenant & owner
router.post('/payments/verify', paymentController.verifyPayment);     // both tenant & owner
router.get('/pgs/:pgId/payments', ownerOrAdmin, paymentController.getPayments);
router.post('/pgs/:pgId/payments/manual', ownerOrAdmin, paymentController.recordManualPayment);
router.post('/payments/:id/refund', ownerOrAdmin, validate(validators.refundPaymentSchema), paymentController.refundPayment);
router.get('/payments/:id/receipt', paymentController.getReceipt);
router.post('/payments/create-link', ownerOrAdmin, validate(validators.createPaymentLinkSchema), paymentController.createPaymentLink);

// ─── Expense Tracking APIs ────────────────────────────────────────────────────
router.post('/pgs/:pgId/expenses', ownerOrAdmin, validate(validators.addExpenseSchema), expenseController.addExpense);
router.get('/pgs/:pgId/expenses', ownerOrAdmin, expenseController.getExpenses);
router.get('/pgs/:pgId/expenses/summary', ownerOrAdmin, expenseController.getExpenseSummary);
router.get('/expenses/:id', ownerOrAdmin, expenseController.getExpense);
router.put('/expenses/:id', ownerOrAdmin, expenseController.updateExpense);
router.delete('/expenses/:id', ownerOrAdmin, expenseController.deleteExpense);
router.post('/expenses/:id/approve', ownerOrAdmin, expenseController.approveExpense);
router.post('/expenses/:id/reject', ownerOrAdmin, expenseController.rejectExpense);
router.post('/expenses/:id/receipt', ownerOrAdmin, expenseController.uploadReceipt);

// ─── Meals Management APIs ────────────────────────────────────────────────────
router.post('/pgs/:pgId/meals', ownerOrAdmin, mealController.createMealMenu);
router.get('/pgs/:pgId/meals', ownerOrAdmin, mealController.getMealMenus);
router.get('/meals/:id', ownerOrAdmin, mealController.getMealMenu);
router.put('/meals/:id', ownerOrAdmin, mealController.updateMealMenu);
router.delete('/meals/:id', ownerOrAdmin, mealController.deleteMealMenu);
router.post('/meals/:id/publish', ownerOrAdmin, mealController.publishMealMenu);

// ─── Digital Agreements APIs ──────────────────────────────────────────────────
router.post('/pgs/:pgId/agreements', ownerOrAdmin, validate(validators.createAgreementSchema), agreementController.createAgreement);
router.get('/pgs/:pgId/agreements', ownerOrAdmin, agreementController.getAgreements);
router.get('/agreements/:id', agreementController.getAgreement);
router.get('/agreements/:id/pdf', agreementController.downloadPDF);
router.put('/agreements/:id', ownerOrAdmin, validate(validators.updateAgreementSchema), agreementController.updateAgreement);
router.post('/agreements/:id/regenerate-pdf', ownerOrAdmin, agreementController.regeneratePDF);

// ─── Owner Staff Hiring Marketplace APIs ──────────────────────────────────────
router.post('/pgs/:pgId/jobs', ownerOrAdmin, validate(validators.createJobPostSchema), hiringController.createJobPost);
router.get('/pgs/:pgId/jobs', ownerOrAdmin, hiringController.getMyJobPosts);
router.put('/jobs/:id', ownerOrAdmin, hiringController.updateJobPost);
router.get('/jobs/:jobId/applications', ownerOrAdmin, hiringController.getJobApplications);
router.put('/applications/:id/status', ownerOrAdmin, hiringController.updateApplicationStatus);

module.exports = router;

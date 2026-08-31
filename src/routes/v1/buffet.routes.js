const express = require('express');
const router = express.Router();

const { protect, authorize, optionalAuth, requireHotelOwner } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');
const upload = require('../../middlewares/upload.middleware');
const validators = require('../../validators/buffet.validator');

// ─── Controllers ──────────────────────────────────────────────────────────────
const publicBuffetCtrl    = require('../../controllers/buffet/public.buffet.controller');
const userBuffetCtrl      = require('../../controllers/buffet/user.buffet.controller');
const ownerHotelCtrl      = require('../../controllers/buffet/owner.hotel.controller');
const ownerBuffetCtrl     = require('../../controllers/buffet/owner.buffet.controller');
const adminAreaCtrl       = require('../../controllers/buffet/admin.area.controller');
const adminCuisineCtrl    = require('../../controllers/buffet/admin.cuisine.controller');
const adminHotelCtrl      = require('../../controllers/buffet/admin.hotel.controller');
const adminBuffetCtrl     = require('../../controllers/buffet/admin.buffet.controller');

// ─── Shorthand guards ─────────────────────────────────────────────────────────
const adminOnly  = [protect, authorize('admin')];
const hotelOwner = [protect, requireHotelOwner];

// =============================================================================
// PUBLIC ROUTES — no auth required (Static paths)
// =============================================================================

// Buffet discovery
router.get('/discover',          publicBuffetCtrl.discoverBuffets);
router.get('/areas/:cityId',     publicBuffetCtrl.getAreasByCity);
router.get('/cuisines',          adminCuisineCtrl.getAllCuisines); // public: list active cuisines

// Hotel public profile
router.get('/hotels/:id',        publicBuffetCtrl.getHotel);
router.get('/hotels/:id/buffets',publicBuffetCtrl.getHotelBuffets);

// =============================================================================
// AUTHENTICATED USER ROUTES — any logged-in user (Static paths)
// =============================================================================

// Hotel registration (any user can apply to become hotel partner)
router.post('/hotel-registration',         protect, validate(validators.hotelRegistrationRequestSchema), ownerHotelCtrl.submitRegistrationRequest);
router.get('/hotel-registration/status',   protect, ownerHotelCtrl.getRegistrationStatus);

// User Reservations (Must come BEFORE generic /:id routes)
router.get('/my-reservations',             protect, userBuffetCtrl.getMyReservations);
router.put('/reservations/:id/cancel',     protect, validate(validators.cancelReservationSchema), userBuffetCtrl.cancelReservation);

// =============================================================================
// HOTEL OWNER ROUTES — requires isHotelOwner: true OR admin
// =============================================================================

// Hotel profile management
router.get( '/hotel/my',                   ...hotelOwner, ownerHotelCtrl.getMyHotel);
router.put( '/hotel/my',                   ...hotelOwner, validate(validators.updateHotelSchema), ownerHotelCtrl.updateMyHotel);
router.post('/hotel/my/images',            ...hotelOwner, upload.single('image'), ownerHotelCtrl.uploadHotelImage);
router.delete('/hotel/my/images/:publicId',...hotelOwner, ownerHotelCtrl.deleteHotelImage);
router.get( '/hotel/my/dashboard',         ...hotelOwner, ownerHotelCtrl.getMyDashboard);
router.get( '/hotel/my/analytics',         ...hotelOwner, ownerBuffetCtrl.getMyAnalytics);

// Buffets
router.post('/hotel/my/buffets',           ...hotelOwner, validate(validators.createBuffetSchema), ownerBuffetCtrl.createMyBuffet);
router.get( '/hotel/my/buffets',           ...hotelOwner, ownerBuffetCtrl.getMyBuffets);
router.get( '/hotel/my/buffets/:id',       ...hotelOwner, ownerBuffetCtrl.getMyBuffet);
router.put( '/hotel/my/buffets/:id',       ...hotelOwner, validate(validators.updateBuffetSchema), ownerBuffetCtrl.updateMyBuffet);
router.post('/hotel/my/buffets/:id/submit',...hotelOwner, ownerBuffetCtrl.submitMyBuffet);
router.post('/hotel/my/buffets/:id/pause', ...hotelOwner, ownerBuffetCtrl.pauseMyBuffet);
router.post('/hotel/my/buffets/:id/cancel',...hotelOwner, ownerBuffetCtrl.cancelMyBuffet);

// Buffet images
router.post('/hotel/my/buffets/:id/images',             ...hotelOwner, upload.single('image'), ownerBuffetCtrl.uploadBuffetImage);
router.delete('/hotel/my/buffets/:buffetId/images/:publicId', ...hotelOwner, ownerBuffetCtrl.deleteBuffetImage);

// Menu
router.get( '/hotel/my/buffets/:id/menu', ...hotelOwner, ownerBuffetCtrl.getMyBuffetMenu);
router.post('/hotel/my/buffets/:id/menu', ...hotelOwner, validate(validators.createMenuSchema), ownerBuffetCtrl.upsertMyBuffetMenu);
router.post('/hotel/my/buffets/:id/menu/items/:itemId/image', ...hotelOwner, upload.single('image'), ownerBuffetCtrl.uploadMenuItemImage);
router.delete('/hotel/my/buffets/:id/menu/items/:itemId/image', ...hotelOwner, ownerBuffetCtrl.deleteMenuItemImage);

// Reservations for a buffet
router.get('/hotel/my/buffets/:id/reservations', ...hotelOwner, ownerBuffetCtrl.getBuffetReservations);

// Weekly plans
router.post('/hotel/my/weekly-plan',      ...hotelOwner, validate(validators.createWeeklyPlanSchema), ownerBuffetCtrl.createWeeklyPlan);
router.get( '/hotel/my/weekly-plans',     ...hotelOwner, ownerBuffetCtrl.getMyWeeklyPlans);

// Promotions
router.get( '/hotel/my/buffets/:id/promotions', ...hotelOwner, ownerBuffetCtrl.getMyPromotions);
router.post('/hotel/my/buffets/:id/promotions', ...hotelOwner, validate(validators.createPromotionSchema), ownerBuffetCtrl.createPromotion);
router.put( '/promotions/:id',            ...hotelOwner, ownerBuffetCtrl.updatePromotion);
router.delete('/promotions/:id',          ...hotelOwner, ownerBuffetCtrl.deletePromotion);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

// Hotel registrations
router.get('/admin/registrations',                    ...adminOnly, adminHotelCtrl.getRegistrations);
router.get('/admin/registrations/:id',                ...adminOnly, adminHotelCtrl.getRegistration);
router.put('/admin/registrations/:id/approve',        ...adminOnly, validate(validators.approveRegistrationSchema), adminHotelCtrl.approveRegistration);
router.put('/admin/registrations/:id/reject',         ...adminOnly, validate(validators.rejectSchema), adminHotelCtrl.rejectRegistration);

// Hotels
router.get( '/admin/hotels',                          ...adminOnly, adminHotelCtrl.getHotels);
router.post('/admin/hotels',                          ...adminOnly, validate(validators.createHotelSchema), adminHotelCtrl.createHotel);
router.get( '/admin/hotels/:id',                      ...adminOnly, adminHotelCtrl.getHotel);
router.put( '/admin/hotels/:id',                      ...adminOnly, validate(validators.updateHotelSchema), adminHotelCtrl.updateHotel);
router.post('/admin/hotels/:id/approve',              ...adminOnly, adminHotelCtrl.approveHotel);
router.post('/admin/hotels/:id/verify',               ...adminOnly, adminHotelCtrl.verifyHotel);
router.post('/admin/hotels/:id/suspend',              ...adminOnly, adminHotelCtrl.suspendHotel);

// Buffets
router.get( '/admin/buffets',                         ...adminOnly, adminBuffetCtrl.getBuffets);
router.post('/admin/buffets',                         ...adminOnly, adminBuffetCtrl.createBuffet);
router.get( '/admin/buffets/:id',                     ...adminOnly, adminBuffetCtrl.getBuffet);
router.put( '/admin/buffets/:id/approve',             ...adminOnly, adminBuffetCtrl.approveBuffet);
router.put( '/admin/buffets/:id/reject',              ...adminOnly, validate(validators.rejectSchema), adminBuffetCtrl.rejectBuffet);
router.put( '/admin/buffets/:id/go-live',             ...adminOnly, adminBuffetCtrl.forceGoLive);

// Weekly plans
router.get('/admin/weekly-plans',                     ...adminOnly, adminBuffetCtrl.getWeeklyPlans);
router.put('/admin/weekly-plans/:id/approve',         ...adminOnly, adminBuffetCtrl.approveWeeklyPlan);
router.put('/admin/weekly-plans/:id/reject',          ...adminOnly, validate(validators.rejectSchema), adminBuffetCtrl.rejectWeeklyPlan);

// Areas
router.get( '/admin/areas',                           ...adminOnly, adminAreaCtrl.getAllAreas);
router.post('/admin/areas',                           ...adminOnly, validate(validators.createAreaSchema), adminAreaCtrl.createArea);
router.put( '/admin/areas/:id',                       ...adminOnly, validate(validators.updateAreaSchema), adminAreaCtrl.updateArea);
router.put( '/admin/areas/:id/toggle',                ...adminOnly, adminAreaCtrl.toggleAreaStatus);
router.delete('/admin/areas/:id',                     ...adminOnly, adminAreaCtrl.deleteArea);

// Cuisines (admin manage)
router.post('/admin/cuisines',                        ...adminOnly, validate(validators.createCuisineSchema), adminCuisineCtrl.createCuisine);
router.put( '/admin/cuisines/:id',                    ...adminOnly, validate(validators.updateCuisineSchema), adminCuisineCtrl.updateCuisine);
router.delete('/admin/cuisines/:id',                  ...adminOnly, adminCuisineCtrl.deleteCuisine);

// Admin analytics + reviews
router.get('/admin/analytics',                        ...adminOnly, adminBuffetCtrl.getAnalytics);
router.get('/admin/reviews',                          ...adminOnly, adminBuffetCtrl.getReviews);
router.put('/admin/reviews/:id/toggle-visibility',    ...adminOnly, adminBuffetCtrl.toggleReviewVisibility);

// =============================================================================
// PARAMETERIZED BUFFET ROUTES (Must come AFTER all specific static routes)
// =============================================================================
router.post('/:id/reserve',                protect, validate(validators.createReservationSchema), userBuffetCtrl.reserveBuffet);
router.post('/:id/reviews',                protect, validate(validators.createReviewSchema), userBuffetCtrl.postBuffetReview);
router.get( '/:id/reviews',                userBuffetCtrl.getBuffetReviews);
router.get( '/:id/menu',                   publicBuffetCtrl.getBuffetMenu);
router.get( '/:id',                        publicBuffetCtrl.getBuffet);

module.exports = router;

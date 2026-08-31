const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const Meal = require('../../models/Meal.model');
const PG   = require('../../models/PG.model');
const Tenant = require('../../models/Tenant.model');
const notificationTrigger = require('../../services/notification/notification.trigger');

/**
 * Helper to normalize date to midnight UTC string / Date object
 */
const normalizeDate = (dateStr) => {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// ─── Owner: Create / Save Meal Menu ───────────────────────────────────────────
exports.createMealMenu = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const { menuDate, meals, notes, status = 'draft' } = req.body;
  if (!menuDate) return errorResponse(res, 'Menu date is required', 400);

  const parsedDate = normalizeDate(menuDate);

  // Check if menu already exists for this date
  let mealDoc = await Meal.findOne({ pg: pgId, menuDate: parsedDate });

  if (mealDoc) {
    // Update existing
    mealDoc.meals  = meals || mealDoc.meals;
    mealDoc.notes  = notes !== undefined ? notes : mealDoc.notes;
    mealDoc.status = status;
    if (status === 'published' && !mealDoc.publishedAt) {
      mealDoc.publishedAt = new Date();
    }
    await mealDoc.save();
  } else {
    // Create new
    mealDoc = await Meal.create({
      pg: pgId,
      owner: ownerId,
      menuDate: parsedDate,
      meals: meals || [],
      notes: notes || '',
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
  }

  // If published, trigger notification to active tenants
  if (status === 'published') {
    notificationTrigger.onMealMenuPublished(mealDoc, pg).catch(() => {});
  }

  return successResponse(res, `Meal menu ${status === 'published' ? 'published' : 'saved'} successfully`, mealDoc, 201);
});

// ─── Owner: Get Meal Menus (Date Range or Single Month) ──────────────────────
exports.getMealMenus = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const { startDate, endDate, date } = req.query;
  const filter = { pg: pgId };

  if (date) {
    filter.menuDate = normalizeDate(date);
  } else if (startDate && endDate) {
    filter.menuDate = {
      $gte: normalizeDate(startDate),
      $lte: normalizeDate(endDate),
    };
  } else {
    // Default to current week (next 7 days starting from today)
    const today = normalizeDate(new Date());
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    filter.menuDate = { $gte: today, $lte: nextWeek };
  }

  const meals = await Meal.find(filter).sort({ menuDate: 1 });
  return successResponse(res, 'Meal menus fetched', meals);
});

// ─── Owner: Get Single Meal Menu ──────────────────────────────────────────────
exports.getMealMenu = asyncHandler(async (req, res) => {
  const meal = await Meal.findOne({ _id: req.params.id, owner: req.user._id });
  if (!meal) return errorResponse(res, 'Meal menu not found', 404);
  return successResponse(res, 'Meal menu fetched', meal);
});

// ─── Owner: Update Meal Menu ──────────────────────────────────────────────────
exports.updateMealMenu = asyncHandler(async (req, res) => {
  const meal = await Meal.findOne({ _id: req.params.id, owner: req.user._id });
  if (!meal) return errorResponse(res, 'Meal menu not found or access denied', 404);

  const { meals, notes, status } = req.body;
  if (meals !== undefined) meal.meals = meals;
  if (notes !== undefined) meal.notes = notes;

  if (status && status !== meal.status) {
    meal.status = status;
    if (status === 'published') {
      meal.publishedAt = new Date();
      const pg = await PG.findById(meal.pg);
      notificationTrigger.onMealMenuPublished(meal, pg).catch(() => {});
    }
  }

  await meal.save();
  return successResponse(res, 'Meal menu updated', meal);
});

// ─── Owner: Delete Meal Menu ──────────────────────────────────────────────────
exports.deleteMealMenu = asyncHandler(async (req, res) => {
  const meal = await Meal.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!meal) return errorResponse(res, 'Meal menu not found or access denied', 404);
  return successResponse(res, 'Meal menu deleted');
});

// ─── Owner: Toggle Publish Status ──────────────────────────────────────────────
exports.publishMealMenu = asyncHandler(async (req, res) => {
  const meal = await Meal.findOne({ _id: req.params.id, owner: req.user._id });
  if (!meal) return errorResponse(res, 'Meal menu not found or access denied', 404);

  const newStatus = meal.status === 'published' ? 'draft' : 'published';
  meal.status = newStatus;
  if (newStatus === 'published') {
    meal.publishedAt = new Date();
    const pg = await PG.findById(meal.pg);
    notificationTrigger.onMealMenuPublished(meal, pg).catch(() => {});
  }
  await meal.save();

  return successResponse(res, `Menu is now ${newStatus}`, meal);
});

// ─── Tenant: Get Meals for My PG ──────────────────────────────────────────────
exports.getMyPGMeals = asyncHandler(async (req, res) => {
  // Find active tenancy for user
  const matchConditions = [{ user: req.user._id }];
  if (req.user.email) matchConditions.push({ email: req.user.email.toLowerCase().trim() });
  if (req.user.phone) {
    const last10 = req.user.phone.toString().trim().replace(/\D/g, '').slice(-10);
    if (last10.length === 10) matchConditions.push({ phone: new RegExp(last10 + '$') });
  }

  const tenant = await Tenant.findOne({
    $or: matchConditions,
    status: { $in: ['active', 'notice', 'pending'] },
  }).select('pg');

  if (!tenant || !tenant.pg) {
    return errorResponse(res, 'No active tenancy found', 404);
  }

  const { date, startDate, endDate } = req.query;
  const filter = { pg: tenant.pg, status: 'published' };

  if (date) {
    filter.menuDate = normalizeDate(date);
  } else if (startDate && endDate) {
    filter.menuDate = {
      $gte: normalizeDate(startDate),
      $lte: normalizeDate(endDate),
    };
  } else {
    // Default: today + next 6 days
    const today = normalizeDate(new Date());
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 6);
    filter.menuDate = { $gte: today, $lte: nextWeek };
  }

  const meals = await Meal.find(filter).sort({ menuDate: 1 });
  return successResponse(res, 'Meals fetched for your PG', meals);
});

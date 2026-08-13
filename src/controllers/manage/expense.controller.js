const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Expense = require('../../models/Expense.model');
const PG      = require('../../models/PG.model');

// ─── Add Expense ──────────────────────────────────────────────────────────────
exports.addExpense = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const expense = await Expense.create({
    pg: pgId,
    owner: ownerId,
    ...req.body,
    approvedBy: ownerId,
    status: 'approved',
  });

  return successResponse(res, 'Expense added successfully', expense, 201);
});

// ─── Get Expenses ─────────────────────────────────────────────────────────────
exports.getExpenses = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const skip  = (page - 1) * limit;

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.startDate && req.query.endDate) {
    filter.expenseDate = {
      $gte: new Date(req.query.startDate),
      $lte: new Date(req.query.endDate),
    };
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('staff', 'name role')
      .sort({ expenseDate: -1 })
      .skip(skip)
      .limit(limit),
    Expense.countDocuments(filter),
  ]);

  // Aggregated total
  const [totalAgg] = await Expense.aggregate([
    { $match: filter },
    { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
  ]);

  return paginatedResponse(res, 'Expenses fetched', expenses, {
    page, limit, total, pages: Math.ceil(total / limit),
    totalExpenseAmount: totalAgg?.totalAmount || 0,
  });
});

// ─── Update Expense ───────────────────────────────────────────────────────────
exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  const ALLOWED = [
    'category', 'subcategory', 'description', 'amount',
    'expenseDate', 'vendor', 'vendorPhone', 'paymentMethod',
    'referenceNumber', 'receiptUrl', 'isRecurring', 'notes',
  ];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) expense[key] = req.body[key]; });

  await expense.save();
  return successResponse(res, 'Expense updated', expense);
});

// ─── Delete Expense ───────────────────────────────────────────────────────────
exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  await expense.deleteOne();
  return successResponse(res, 'Expense deleted');
});

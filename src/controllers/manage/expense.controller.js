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
    status: req.body.status || 'approved',
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
  if (req.query.status)   filter.status   = req.query.status;
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

// ─── Get Single Expense ───────────────────────────────────────────────────────
exports.getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id })
    .populate('staff', 'name role phone')
    .populate('pg', 'name address');

  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  return successResponse(res, 'Expense fetched', expense);
});

// ─── Update Expense ───────────────────────────────────────────────────────────
exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  const ALLOWED = [
    'category', 'subcategory', 'description', 'amount',
    'expenseDate', 'vendor', 'vendorPhone', 'paymentMethod',
    'referenceNumber', 'receiptUrl', 'receiptPublicId', 'isRecurring', 'notes', 'status',
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

// ─── Approve Expense ──────────────────────────────────────────────────────────
exports.approveExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  expense.status = 'approved';
  expense.approvedBy = req.user._id;
  await expense.save();

  return successResponse(res, 'Expense approved', expense);
});

// ─── Reject Expense ───────────────────────────────────────────────────────────
exports.rejectExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  expense.status = 'rejected';
  expense.notes = (expense.notes ? `${expense.notes}\n` : '') + `Rejected: ${req.body.reason || 'No reason provided'}`;
  await expense.save();

  return successResponse(res, 'Expense rejected', expense);
});

// ─── Upload / Update Receipt ──────────────────────────────────────────────────
exports.uploadReceipt = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, owner: req.user._id });
  if (!expense) return errorResponse(res, 'Expense not found or access denied', 404);

  const { receiptUrl, receiptPublicId } = req.body;
  if (!receiptUrl) return errorResponse(res, 'receiptUrl is required', 400);

  expense.receiptUrl = receiptUrl;
  if (receiptPublicId) expense.receiptPublicId = receiptPublicId;
  await expense.save();

  return successResponse(res, 'Receipt uploaded successfully', expense);
});

// ─── Expense Summary (by category and monthly breakdown) ──────────────────────
exports.getExpenseSummary = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear   = new Date(year, 11, 31, 23, 59, 59);

  const matchFilter = {
    pg: pg._id,
    owner: ownerId,
    status: 'approved',
    expenseDate: { $gte: startOfYear, $lte: endOfYear },
  };

  if (req.query.month) {
    const m = parseInt(req.query.month, 10);
    if (!isNaN(m) && m >= 1 && m <= 12) {
      matchFilter.expenseDate = {
        $gte: new Date(year, m - 1, 1),
        $lte: new Date(year, m, 0, 23, 59, 59),
      };
    }
  }

  // 1. Category Breakdown
  const byCategory = await Expense.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id:         '$category',
        totalAmount: { $sum: '$amount' },
        count:       { $sum: 1 },
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);

  // 2. Monthly Trend for Year
  const monthlyTrend = await Expense.aggregate([
    {
      $match: {
        pg: pg._id,
        owner: ownerId,
        status: 'approved',
        expenseDate: { $gte: startOfYear, $lte: endOfYear },
      },
    },
    {
      $group: {
        _id:         { $month: '$expenseDate' },
        totalAmount: { $sum: '$amount' },
        count:       { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totalExpense = byCategory.reduce((sum, item) => sum + item.totalAmount, 0);

  return successResponse(res, 'Expense summary fetched', {
    year,
    totalExpense,
    byCategory,
    monthlyTrend,
  });
});

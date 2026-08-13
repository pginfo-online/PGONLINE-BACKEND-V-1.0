const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const PG          = require('../../models/PG.model');
const Bed         = require('../../models/Bed.model');
const Tenant      = require('../../models/Tenant.model');
const RentRecord  = require('../../models/RentRecord.model');
const Expense     = require('../../models/Expense.model');
const Staff       = require('../../models/Staff.model');

// ─── Owner Dashboard Overview ────────────────────────────────────────────────
exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const ownerId = req.user._id;

  // 1. Get all PGs owned by user
  const pgs = await PG.find({ owner: ownerId }).select('_id name city area totalBeds availableBeds');
  const pgIds = pgs.map(p => p._id);

  if (pgIds.length === 0) {
    return successResponse(res, 'Dashboard summary fetched', {
      totalPGs: 0,
      occupancy: { totalBeds: 0, occupiedBeds: 0, vacantBeds: 0, occupancyRate: 0 },
      financials: { totalCollectedThisMonth: 0, totalPendingThisMonth: 0, totalExpensesThisMonth: 0, netProfitThisMonth: 0 },
      counts: { activeTenants: 0, activeStaff: 0, openComplaints: 0 },
      pgs: [],
    });
  }

  const currentMonth = new Date().getMonth() + 1;
  const currentYear  = new Date().getFullYear();

  // 2. Bed Occupancy Aggregation
  const [bedStats] = await Bed.aggregate([
    { $match: { owner: ownerId } },
    {
      $group: {
        _id:      null,
        total:    { $sum: 1 },
        occupied: { $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] } },
        vacant:   { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },   1, 0] } },
      },
    },
  ]);

  const totalBeds    = bedStats?.total || 0;
  const occupiedBeds = bedStats?.occupied || 0;
  const vacantBeds   = bedStats?.vacant || 0;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  // 3. Financial Summary for Current Month
  const [rentFinancials] = await RentRecord.aggregate([
    { $match: { owner: ownerId, billingMonth: currentMonth, billingYear: currentYear } },
    {
      $group: {
        _id:             null,
        totalCollected:  { $sum: '$paidAmount' },
        totalDue:        { $sum: '$totalAmount' },
      },
    },
  ]);

  const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const endOfMonth   = new Date(currentYear, currentMonth, 0, 23, 59, 59);

  const [expenseFinancials] = await Expense.aggregate([
    { $match: { owner: ownerId, expenseDate: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $group: { _id: null, totalExpense: { $sum: '$amount' } } },
  ]);

  const totalCollectedThisMonth = rentFinancials?.totalCollected || 0;
  const totalDueThisMonth       = rentFinancials?.totalDue || 0;
  const totalPendingThisMonth   = Math.max(0, totalDueThisMonth - totalCollectedThisMonth);
  const totalExpensesThisMonth  = expenseFinancials?.totalExpense || 0;
  const netProfitThisMonth      = totalCollectedThisMonth - totalExpensesThisMonth;

  // 4. Quick Counts
  const [activeTenants, activeStaff] = await Promise.all([
    Tenant.countDocuments({ owner: ownerId, status: 'active' }),
    Staff.countDocuments({ owner: ownerId, status: 'active' }),
  ]);

  return successResponse(res, 'Dashboard summary fetched', {
    totalPGs: pgs.length,
    occupancy: {
      totalBeds,
      occupiedBeds,
      vacantBeds,
      occupancyRate,
    },
    financials: {
      totalCollectedThisMonth,
      totalPendingThisMonth,
      totalExpensesThisMonth,
      netProfitThisMonth,
    },
    counts: {
      activeTenants,
      activeStaff,
    },
    pgs,
  });
});

// ─── Financial P&L Report ─────────────────────────────────────────────────────
exports.getFinancialReport = asyncHandler(async (req, res) => {
  const ownerId = req.user._id;
  const year    = parseInt(req.query.year) || new Date().getFullYear();

  // Monthly breakdown of rent collected vs expenses
  const rentMonthly = await RentRecord.aggregate([
    { $match: { owner: ownerId, billingYear: year } },
    {
      $group: {
        _id:            '$billingMonth',
        totalCollected: { $sum: '$paidAmount' },
        totalDue:       { $sum: '$totalAmount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const startOfYear = new Date(year, 0, 1);
  const endOfYear   = new Date(year, 11, 31, 23, 59, 59);

  const expenseMonthly = await Expense.aggregate([
    { $match: { owner: ownerId, expenseDate: { $gte: startOfYear, $lte: endOfYear } } },
    {
      $group: {
        _id:          { $month: '$expenseDate' },
        totalExpense: { $sum: '$amount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const report = monthNames.map((name, index) => {
    const monthNum = index + 1;
    const rent    = rentMonthly.find(r => r._id === monthNum) || { totalCollected: 0, totalDue: 0 };
    const expense = expenseMonthly.find(e => e._id === monthNum) || { totalExpense: 0 };

    return {
      month:       name,
      monthNumber: monthNum,
      revenue:     rent.totalCollected,
      due:         rent.totalDue,
      expenses:    expense.totalExpense,
      profit:      rent.totalCollected - expense.totalExpense,
    };
  });

  return successResponse(res, `Financial report for ${year}`, { year, report });
});

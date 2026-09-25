const mongoose      = require('mongoose');
const asyncHandler  = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const PG          = require('../../models/PG.model');
const Bed         = require('../../models/Bed.model');
const Room        = require('../../models/Room.model');
const Tenant      = require('../../models/Tenant.model');
const RentRecord  = require('../../models/RentRecord.model');
const Expense     = require('../../models/Expense.model');
const Staff       = require('../../models/Staff.model');
const Payment     = require('../../models/Payment.model');

// ─── Owner Dashboard Overview ────────────────────────────────────────────────
exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const ownerId = req.user._id;

  // 1. Get all PGs owned by user
  // Note: totalBeds & availableBeds are Mongoose virtuals (computed from roomConfigs).
  // They cannot be .select()'d — we must fetch the needed base fields and let virtuals compute.
  const pgs = await PG.find({ owner: ownerId })
    .select('_id name city area roomConfigs monthlyPricing')
    .lean({ virtuals: true });
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
  const year    = parseInt(req.query.year, 10) || new Date().getFullYear();
  const pgId    = req.query.pgId;

  // Monthly breakdown of rent collected vs expenses
  const rentMatch = { owner: ownerId, billingYear: year };
  if (pgId && mongoose.Types.ObjectId.isValid(pgId)) {
    rentMatch.pg = new mongoose.Types.ObjectId(pgId);
  }

  const rentMonthly = await RentRecord.aggregate([
    { $match: rentMatch },
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

  const expenseMatch = {
    owner: ownerId,
    expenseDate: { $gte: startOfYear, $lte: endOfYear },
    status: 'approved',
  };
  if (pgId && mongoose.Types.ObjectId.isValid(pgId)) {
    expenseMatch.pg = new mongoose.Types.ObjectId(pgId);
  }

  const expenseMonthly = await Expense.aggregate([
    { $match: expenseMatch },
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

  const totalRevenue  = report.reduce((sum, r) => sum + r.revenue, 0);
  const totalExpenses = report.reduce((sum, r) => sum + r.expenses, 0);
  const totalDue      = report.reduce((sum, r) => sum + r.due, 0);
  const netProfit     = totalRevenue - totalExpenses;

  return successResponse(res, `Financial report for ${year}`, {
    year,
    totalRevenue,
    totalExpenses,
    totalDue,
    netProfit,
    report,
  });
});

// ─── Property-Scoped Dashboard Overview ───────────────────────────────────────
exports.getPropertyDashboard = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId })
    .select('_id name address city area images phone status')
    .lean();

  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const currentMonth = new Date().getMonth() + 1;
  const currentYear  = new Date().getFullYear();
  const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const endOfMonth   = new Date(currentYear, currentMonth, 0, 23, 59, 59);

  // 1. Bed & Room Occupancy
  const [bedStats, rooms] = await Promise.all([
    Bed.aggregate([
      { $match: { pg: pg._id, owner: ownerId } },
      {
        $group: {
          _id:      null,
          total:    { $sum: 1 },
          occupied: { $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] } },
          vacant:   { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },   1, 0] } },
        },
      },
    ]),
    Room.find({ pg: pg._id, owner: ownerId }).select('_id status totalBeds occupiedBeds vacantBeds').lean(),
  ]);

  const totalBeds     = bedStats[0]?.total || 0;
  const occupiedBeds  = bedStats[0]?.occupied || 0;
  const vacantBeds    = bedStats[0]?.vacant || 0;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  const totalRooms    = rooms.length;
  const vacantRooms   = rooms.filter((r) => (r.occupiedBeds || 0) === 0).length;
  const occupiedRooms = rooms.filter((r) => (r.occupiedBeds || 0) >= (r.totalBeds || 1)).length;
  const partialRooms  = totalRooms - vacantRooms - occupiedRooms;

  // 2. Financial Metrics for Current Month
  const [rentFinancials, expenseFinancials] = await Promise.all([
    RentRecord.aggregate([
      { $match: { pg: pg._id, owner: ownerId, billingMonth: currentMonth, billingYear: currentYear } },
      {
        $group: {
          _id:             null,
          totalDue:        { $sum: '$totalAmount' },
          totalCollected:  { $sum: '$paidAmount' },
          overdueCount:    { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
          paidCount:       { $sum: { $cond: [{ $eq: ['$status', 'paid'] },    1, 0] } },
          pendingCount:    { $sum: { $cond: [{ $in: ['$status', ['pending', 'partial']] }, 1, 0] } },
        },
      },
    ]),
    Expense.aggregate([
      { $match: { pg: pg._id, owner: ownerId, expenseDate: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: null, totalExpense: { $sum: '$amount' } } },
    ]),
  ]);

  const totalDue           = rentFinancials[0]?.totalDue || 0;
  const totalCollected     = rentFinancials[0]?.totalCollected || 0;
  const totalPending       = Math.max(0, totalDue - totalCollected);
  const collectionRate     = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0;
  const totalExpenses      = expenseFinancials[0]?.totalExpense || 0;
  const netProfit          = totalCollected - totalExpenses;

  // 3. Tenant Counts & Notice tracking
  const [activeTenants, pendingTenants, noticeTenants, staffCount] = await Promise.all([
    Tenant.countDocuments({ pg: pg._id, owner: ownerId, status: 'active' }),
    Tenant.countDocuments({ pg: pg._id, owner: ownerId, status: 'pending' }),
    Tenant.find({ pg: pg._id, owner: ownerId, status: 'notice' })
      .select('name phone room expectedLeaveDate noticePeriodDays profilePhoto')
      .populate('room', 'roomNumber')
      .lean(),
    Staff.countDocuments({ pg: pg._id, owner: ownerId, status: 'active' }),
  ]);

  // 4. Overdue Rent Alerts
  const overdueTenants = await RentRecord.find({
    pg: pg._id,
    owner: ownerId,
    status: 'overdue',
  })
    .populate('tenant', 'name phone profilePhoto')
    .populate('room', 'roomNumber')
    .sort({ dueDate: 1 })
    .limit(5)
    .lean();

  const enrichedOverdue = overdueTenants.map((rec) => {
    const daysOverdue = Math.max(1, Math.round((Date.now() - new Date(rec.dueDate).getTime()) / (1000 * 3600 * 24)));
    return {
      _id: rec._id,
      tenantName: rec.tenant?.name || 'Tenant',
      tenantPhone: rec.tenant?.phone || '',
      roomNumber: rec.room?.roomNumber || 'N/A',
      amountDue: rec.totalAmount - rec.paidAmount,
      dueDate: rec.dueDate,
      daysOverdue,
      paymentLink: rec.paymentLink,
    };
  });

  // 5. Recent Activity (Latest payments & latest tenant joins)
  const [recentPayments, recentTenants] = await Promise.all([
    Payment.find({ pg: pg._id, owner: ownerId, status: 'paid' })
      .populate('tenant', 'name phone profilePhoto')
      .sort({ paidAt: -1, createdAt: -1 })
      .limit(5)
      .lean(),
    Tenant.find({ pg: pg._id, owner: ownerId })
      .select('name phone status joinDate monthlyRent room profilePhoto')
      .populate('room', 'roomNumber')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  return successResponse(res, 'Property dashboard fetched', {
    property: pg,
    occupancy: {
      totalBeds,
      occupiedBeds,
      vacantBeds,
      occupancyRate,
      totalRooms,
      vacantRooms,
      occupiedRooms,
      partialRooms,
    },
    financials: {
      currentMonth,
      currentYear,
      totalDue,
      totalCollected,
      totalPending,
      collectionRate,
      totalExpenses,
      netProfit,
    },
    counts: {
      activeTenants,
      pendingTenants,
      noticeTenantsCount: noticeTenants.length,
      staffCount,
    },
    alerts: {
      overdueCount: rentFinancials[0]?.overdueCount || 0,
      overdueTenants: enrichedOverdue,
      noticeTenants,
    },
    recentActivity: {
      payments: recentPayments,
      tenants: recentTenants,
    },
  });
});

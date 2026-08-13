const RentRecord = require('../../models/RentRecord.model');
const Tenant = require('../../models/Tenant.model');

/**
 * Rent Service
 *
 * Handles rent generation, overdue detection, and payment recording.
 */

/**
 * Generate rent records for all active tenants of a PG for a given month.
 *
 * - Idempotent: will not create duplicate records (unique index on tenant+month+year)
 * - Returns { created, skipped } counts
 *
 * @param {string} pgId
 * @param {string} ownerId
 * @param {number} month - 1-12
 * @param {number} year
 * @param {number} dueDayOfMonth - default 5
 */
const generateMonthlyRent = async (pgId, ownerId, month, year, dueDayOfMonth = 5) => {
  const tenants = await Tenant.find({
    pg: pgId,
    owner: ownerId,
    status: 'active',
  }).select('_id monthlyRent room bed');

  let created = 0;
  let skipped = 0;

  const dueDate = new Date(year, month - 1, dueDayOfMonth);

  for (const tenant of tenants) {
    try {
      const existing = await RentRecord.findOne({
        tenant:       tenant._id,
        billingMonth: month,
        billingYear:  year,
      });

      if (existing) {
        skipped++;
        continue;
      }

      const totalAmount = tenant.monthlyRent;

      await RentRecord.create({
        tenant:       tenant._id,
        pg:           pgId,
        owner:        ownerId,
        room:         tenant.room,
        bed:          tenant.bed,
        billingMonth: month,
        billingYear:  year,
        rentAmount:   totalAmount,
        totalAmount,
        paidAmount:   0,
        dueDate,
        status:       'pending',
      });

      created++;
    } catch (err) {
      // Skip duplicate key errors silently (concurrent generation guard)
      if (err.code === 11000) {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { created, skipped, total: tenants.length };
};

/**
 * Mark pending/overdue rent records as overdue
 * (typically run by a daily cron / scheduled job).
 *
 * @param {string} pgId - optional; if omitted, applies globally
 */
const markOverdueRecords = async (pgId = null) => {
  const today = new Date();
  const query = {
    status:  { $in: ['pending', 'partial'] },
    dueDate: { $lt: today },
  };
  if (pgId) query.pg = pgId;

  const result = await RentRecord.updateMany(query, { $set: { status: 'overdue' } });
  return result.modifiedCount;
};

/**
 * Record a (partial or full) payment against a rent record.
 *
 * @param {string} rentRecordId
 * @param {number} amount - Amount paid
 * @param {object} paymentInfo - { method, reference, notes }
 * @returns {RentRecord} Updated record
 */
const recordPayment = async (rentRecordId, amount, paymentInfo = {}) => {
  const record = await RentRecord.findById(rentRecordId);
  if (!record) throw new Error('Rent record not found');

  if (record.status === 'paid' || record.status === 'waived') {
    throw new Error(`Rent record is already ${record.status}`);
  }

  const newPaid = record.paidAmount + amount;
  const newStatus = newPaid >= record.totalAmount ? 'paid' : 'partial';

  record.paidAmount = Math.min(newPaid, record.totalAmount);
  record.status = newStatus;
  record.paymentHistory.push({
    amount,
    paidAt:    new Date(),
    method:    paymentInfo.method || 'cash',
    reference: paymentInfo.reference || null,
    notes:     paymentInfo.notes || null,
  });

  await record.save();
  return record;
};

/**
 * Get rent summary for a PG (outstanding, collected, overdue).
 *
 * @param {string} pgId
 * @param {number} month - optional filter
 * @param {number} year  - optional filter
 */
const getRentSummary = async (pgId, month = null, year = null) => {
  const mongoose = require('mongoose');
  const pgObjectId = typeof pgId === 'string' ? new mongoose.Types.ObjectId(pgId) : pgId;
  const match = { pg: pgObjectId };

  if (month) match.billingMonth = month;
  if (year)  match.billingYear  = year;

  const [summary] = await RentRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id:              null,
        totalDue:         { $sum: '$totalAmount' },
        totalCollected:   { $sum: '$paidAmount' },
        overdueCount:     { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
        paidCount:        { $sum: { $cond: [{ $eq: ['$status', 'paid']    }, 1, 0] } },
        pendingCount:     { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        partialCount:     { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
      },
    },
    {
      $addFields: {
        totalOutstanding: { $subtract: ['$totalDue', '$totalCollected'] },
      },
    },
  ]);

  return summary || {
    totalDue: 0, totalCollected: 0, totalOutstanding: 0,
    overdueCount: 0, paidCount: 0, pendingCount: 0, partialCount: 0,
  };
};

module.exports = { generateMonthlyRent, markOverdueRecords, recordPayment, getRentSummary };

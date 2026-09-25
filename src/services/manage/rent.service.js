const mongoose = require('mongoose');
const RentRecord = require('../../models/RentRecord.model');
const Tenant = require('../../models/Tenant.model');
const { logger } = require('../../utils/logger');

/**
 * Rent Service
 *
 * Production-grade rent management service:
 * - Generates rent records (standard or custom tenant billing cycles)
 * - Computes billing periods and due dates
 * - Tracks payments and status transitions (pending -> partial -> paid / overdue)
 * - Manages reminder delivery logs
 * - Manages Razorpay payment links
 * - Provides comprehensive financial summaries
 */

/**
 * Generate rent records for all active tenants of a PG for a given month.
 *
 * - Idempotent: will not create duplicate records (unique index on tenant+month+year)
 * - Returns { created, skipped, total, records }
 *
 * @param {string} pgId
 * @param {string} ownerId
 * @param {number} month - 1-12
 * @param {number} year
 * @param {number} defaultDueDayOfMonth - default 5
 */
const generateMonthlyRent = async (pgId, ownerId, month, year, defaultDueDayOfMonth = 5) => {
  const tenants = await Tenant.find({
    pg: pgId,
    owner: ownerId,
    status: 'active',
  }).select('_id name phone email monthlyRent room bed rentCycle billingDate');

  let created = 0;
  let skipped = 0;
  const createdRecords = [];

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

      // Determine due date and billing period
      const isCustomCycle = tenant.rentCycle === 'custom' && tenant.billingDate;
      const dueDay = isCustomCycle ? tenant.billingDate : defaultDueDayOfMonth;

      // Safe date creation (handle months with fewer days e.g. Feb 28/29)
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const clampedDueDay = Math.min(dueDay, lastDayOfMonth);
      const dueDate = new Date(year, month - 1, clampedDueDay);

      // Billing period calculation
      let billingPeriodStart;
      let billingPeriodEnd;

      if (isCustomCycle) {
        billingPeriodStart = new Date(year, month - 1, clampedDueDay);
        // End date is 1 day before the next month's billing date
        const nextMonthYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextMonthLastDay = new Date(nextMonthYear, nextMonth, 0).getDate();
        const nextClampedDay = Math.min(tenant.billingDate, nextMonthLastDay);
        billingPeriodEnd = new Date(nextMonthYear, nextMonth - 1, nextClampedDay - 1, 23, 59, 59);
      } else {
        billingPeriodStart = new Date(year, month - 1, 1);
        billingPeriodEnd   = new Date(year, month, 0, 23, 59, 59);
      }

      const totalAmount = tenant.monthlyRent;

      const record = await RentRecord.create({
        tenant:             tenant._id,
        pg:                 pgId,
        owner:              ownerId,
        room:               tenant.room,
        bed:                tenant.bed,
        billingMonth:       month,
        billingYear:        year,
        billingPeriodStart,
        billingPeriodEnd,
        rentAmount:         totalAmount,
        totalAmount,
        paidAmount:         0,
        dueDate,
        status:             'pending',
      });

      createdRecords.push(record);
      created++;
    } catch (err) {
      // Skip duplicate key errors silently (concurrent generation guard)
      if (err.code === 11000) {
        skipped++;
      } else {
        logger.error(`[RentService] Error creating rent record for tenant ${tenant._id}: ${err.message}`);
        throw err;
      }
    }
  }

  return { created, skipped, total: tenants.length, records: createdRecords };
};

/**
 * Update an existing rent record (amounts, due date, status, notes).
 * Automatically recalculates totalAmount and updates status.
 */
const updateRentRecord = async (rentRecordId, ownerId, updateData) => {
  const record = await RentRecord.findOne({ _id: rentRecordId, owner: ownerId });
  if (!record) {
    throw new Error('Rent record not found or access denied');
  }

  if (updateData.rentAmount !== undefined) {
    record.rentAmount = Number(updateData.rentAmount);
  }
  if (updateData.lateFee !== undefined) {
    record.lateFee = Number(updateData.lateFee);
  }
  if (updateData.discount !== undefined) {
    record.discount = Number(updateData.discount);
  }
  if (updateData.additionalCharges !== undefined && Array.isArray(updateData.additionalCharges)) {
    record.additionalCharges = updateData.additionalCharges.map((c) => ({
      description: c.description,
      amount: Number(c.amount) || 0,
    }));
  }
  if (updateData.dueDate) {
    record.dueDate = new Date(updateData.dueDate);
  }
  if (updateData.billingPeriodStart) {
    record.billingPeriodStart = new Date(updateData.billingPeriodStart);
  }
  if (updateData.billingPeriodEnd) {
    record.billingPeriodEnd = new Date(updateData.billingPeriodEnd);
  }
  if (updateData.notes !== undefined) {
    record.notes = updateData.notes;
  }

  // Recalculate total amount
  const addChargesSum = record.additionalCharges.reduce((sum, item) => sum + (item.amount || 0), 0);
  record.totalAmount = Math.max(0, record.rentAmount + record.lateFee - record.discount + addChargesSum);

  // Auto-update status based on paidAmount vs totalAmount, unless manually set to waived
  if (updateData.status === 'waived') {
    record.status = 'waived';
  } else if (record.paidAmount >= record.totalAmount && record.totalAmount > 0) {
    record.status = 'paid';
  } else if (record.paidAmount > 0) {
    record.status = 'partial';
  } else {
    // If overdue
    const isPastDue = new Date() > new Date(record.dueDate);
    record.status = isPastDue ? 'overdue' : 'pending';
  }

  await record.save();
  return record;
};

/**
 * Delete a rent record.
 * Only allowed if no payments have been recorded.
 */
const deleteRentRecord = async (rentRecordId, ownerId) => {
  const record = await RentRecord.findOne({ _id: rentRecordId, owner: ownerId });
  if (!record) {
    throw new Error('Rent record not found or access denied');
  }

  if (record.paidAmount > 0) {
    throw new Error(`Cannot delete rent record with recorded payments (₹${record.paidAmount}). Refund payments first.`);
  }

  await record.deleteOne();
  return { success: true, message: 'Rent record deleted successfully' };
};

/**
 * Mark pending/overdue rent records as overdue
 * (typically run by a daily cron / scheduled BullMQ worker).
 *
 * @param {string} [pgId] - optional; if omitted, applies globally
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
 * Record a reminder log on the rent record.
 */
const recordReminderSent = async (rentRecordId, reminderData) => {
  const record = await RentRecord.findById(rentRecordId);
  if (!record) throw new Error('Rent record not found');

  record.remindersSent.push({
    channel:   reminderData.channel || 'whatsapp',
    type:      reminderData.type || 'due_reminder',
    sentAt:    new Date(),
    status:    reminderData.status || 'sent',
    sentBy:    reminderData.sentBy || null,
    messageId: reminderData.messageId || null,
    error:     reminderData.error || null,
  });

  await record.save();
  return record;
};

/**
 * Attach Razorpay payment link to rent record.
 */
const setPaymentLink = async (rentRecordId, paymentLink, paymentLinkId) => {
  const record = await RentRecord.findById(rentRecordId);
  if (!record) throw new Error('Rent record not found');

  record.paymentLink   = paymentLink;
  record.paymentLinkId = paymentLinkId;
  await record.save();
  return record;
};

/**
 * Get rent summary for a PG (outstanding, collected, overdue).
 *
 * @param {string} pgId
 * @param {number} [month] - optional filter
 * @param {number} [year]  - optional filter
 */
const getRentSummary = async (pgId, month = null, year = null) => {
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

module.exports = {
  generateMonthlyRent,
  updateRentRecord,
  deleteRentRecord,
  markOverdueRecords,
  recordPayment,
  recordReminderSent,
  setPaymentLink,
  getRentSummary,
};

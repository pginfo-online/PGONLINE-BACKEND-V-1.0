/**
 * notification.trigger.js
 *
 * Event-driven notification triggers.
 * Each function is called by a controller after a domain event.
 *
 * Design principles:
 * - All functions are fire-and-forget (never throw to the caller)
 * - Each function builds the appropriate audience + payload
 * - Calls notification.service.createAndSend()
 * - Errors are logged but never propagated
 */

const { createAndSend } = require('./notification.service');
const { NOTIFICATION_TYPES, buildPayload } = require('./notification.types');
const { logger } = require('../../utils/logger');
const Tenant = require('../../models/Tenant.model');
const User   = require('../../models/User.model');

/**
 * Safe wrapper — ensures trigger functions never throw.
 */
function safeTrigger(name, fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      logger.error(`[NotificationTrigger] ${name} failed: ${err.message}`);
    }
  };
}

// ─── PG Triggers ──────────────────────────────────────────────────────────────

/**
 * Owner receives notification when their PG is approved.
 */
const onPGApproved = safeTrigger('onPGApproved', async (pg) => {
  if (!pg?.owner) return;

  const payload = buildPayload(NOTIFICATION_TYPES.PG_APPROVED, {
    pgName: pg.name,
    city:   pg.city,
    area:   pg.area,
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.PG_APPROVED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   `pginfo://pg/${pg._id}`,
      entityType: 'PG',
      entityId:   pg._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [pg.owner._id || pg.owner] },
    isTransactional: true,
  });
});

/**
 * Owner receives notification when their PG is rejected.
 */
const onPGRejected = safeTrigger('onPGRejected', async (pg, reason) => {
  if (!pg?.owner) return;

  const payload = buildPayload(NOTIFICATION_TYPES.PG_REJECTED, {
    pgName: pg.name,
    reason: reason || 'Does not meet listing requirements',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.PG_REJECTED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   `pginfo://pg/${pg._id}`,
      entityType: 'PG',
      entityId:   pg._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [pg.owner._id || pg.owner] },
    isTransactional: true,
  });
});

/**
 * Notify users in the same city when a new PG goes live (promotional).
 */
const onPGLive = safeTrigger('onPGLive', async (pg) => {
  if (!pg?.city) return;

  const payload = buildPayload(NOTIFICATION_TYPES.PG_LIVE, {
    pgName: pg.name,
    city:   pg.city,
    area:   pg.area,
  });

  await createAndSend({
    type:     NOTIFICATION_TYPES.PG_LIVE,
    title:    payload.title,
    body:     payload.body,
    imageUrl: pg.photos?.[0]?.url || null,
    data: {
      deepLink:   `pginfo://pg/${pg._id}`,
      entityType: 'PG',
      entityId:   pg._id.toString(),
    },
    audience:       { type: 'role', targetRoles: ['tenant'] },
    isTransactional: false,
  });
});

// ─── Tenant Triggers ──────────────────────────────────────────────────────────

/**
 * Notify a tenant user when they are added to a PG.
 */
const onTenantAdded = safeTrigger('onTenantAdded', async (tenant, pg) => {
  if (!tenant?.user) return; // no linked user account — can't push

  const payload = buildPayload(NOTIFICATION_TYPES.TENANT_ADDED, {
    pgName: pg?.name || 'your PG',
    city:   pg?.city || '',
    area:   pg?.area || '',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.TENANT_ADDED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home',
      entityType: 'Tenant',
      entityId:   tenant._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [tenant.user] },
    isTransactional: true,
  });
});

/**
 * Notify a tenant when their bed is assigned.
 */
const onBedAssigned = safeTrigger('onBedAssigned', async (tenant) => {
  if (!tenant?.user) return;

  // Populate bed and room info if not present
  const populated = await Tenant.findById(tenant._id)
    .populate('bed',  'bedLabel')
    .populate('room', 'roomNumber')
    .populate('pg',   'name')
    .lean();

  const payload = buildPayload(NOTIFICATION_TYPES.TENANT_BED_ASSIGNED, {
    bedLabel:   populated?.bed?.bedLabel   || 'your bed',
    roomNumber: populated?.room?.roomNumber || 'your room',
    pgName:     populated?.pg?.name        || 'your PG',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.TENANT_BED_ASSIGNED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home',
      entityType: 'Tenant',
      entityId:   tenant._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [tenant.user] },
    isTransactional: true,
  });
});

/**
 * Notify the owner when a tenant vacates.
 */
const onTenantVacated = safeTrigger('onTenantVacated', async (tenant) => {
  if (!tenant?.owner) return;

  const populated = await Tenant.findById(tenant._id)
    .populate('pg', 'name')
    .lean();

  const payload = buildPayload(NOTIFICATION_TYPES.TENANT_VACATED, {
    tenantName: populated?.name || 'A tenant',
    pgName:     populated?.pg?.name || 'your PG',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.TENANT_VACATED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://manage',
      entityType: 'PG',
      entityId:   (populated?.pg?._id || tenant.pg)?.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [tenant.owner._id || tenant.owner] },
    isTransactional: false,
  });
});

// ─── Payment Triggers ─────────────────────────────────────────────────────────

/**
 * Notify tenant and owner on successful payment.
 */
const onPaymentSuccess = safeTrigger('onPaymentSuccess', async (payment) => {
  const Payment = require('../../models/Payment.model');
  const populated = await Payment.findById(payment._id)
    .populate('tenant', 'user name')
    .populate('pg',     'name owner')
    .lean();

  if (!populated) return;

  const amount = `₹${populated.amount?.toLocaleString('en-IN')}`;
  const payload = buildPayload(NOTIFICATION_TYPES.PAYMENT_SUCCESS, {
    amount,
    month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
  });

  const recipients = [];

  // Notify tenant user
  if (populated.tenant?.user) {
    recipients.push(populated.tenant.user.toString());
  }
  // Notify owner
  if (populated.pg?.owner) {
    // Build slightly different message for owner
    const ownerPayload = buildPayload(NOTIFICATION_TYPES.PAYMENT_SUCCESS, {
      amount,
      month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    });

    await createAndSend({
      type:  NOTIFICATION_TYPES.PAYMENT_SUCCESS,
      title: '💰 Payment Received',
      body:  `${populated.tenant?.name || 'A tenant'} paid ${amount} for ${populated.pg?.name}.`,
      data: {
        deepLink:   'pginfo://manage',
        entityType: 'Payment',
        entityId:   payment._id.toString(),
      },
      audience:       { type: 'specific', targetUserIds: [populated.pg.owner] },
      isTransactional: true,
    });
  }

  if (recipients.length > 0) {
    await createAndSend({
      type:  NOTIFICATION_TYPES.PAYMENT_SUCCESS,
      title: payload.title,
      body:  payload.body,
      data: {
        deepLink:   'pginfo://tenant-home/payments',
        entityType: 'Payment',
        entityId:   payment._id.toString(),
      },
      audience:       { type: 'specific', targetUserIds: recipients },
      isTransactional: true,
    });
  }
});

/**
 * Notify tenant on payment failure.
 */
const onPaymentFailed = safeTrigger('onPaymentFailed', async (payment) => {
  const Payment = require('../../models/Payment.model');
  const populated = await Payment.findById(payment._id)
    .populate('tenant', 'user')
    .lean();

  if (!populated?.tenant?.user) return;

  const payload = buildPayload(NOTIFICATION_TYPES.PAYMENT_FAILED, {
    amount: `₹${populated.amount?.toLocaleString('en-IN')}`,
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.PAYMENT_FAILED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home/payments',
      entityType: 'Payment',
      entityId:   payment._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [populated.tenant.user] },
    isTransactional: true,
  });
});

/**
 * Notify tenant on manual (cash/UPI) payment recorded by owner.
 */
const onManualPaymentRecorded = safeTrigger('onManualPaymentRecorded', async (payment) => {
  const Payment = require('../../models/Payment.model');
  const populated = await Payment.findById(payment._id)
    .populate('tenant', 'user')
    .lean();

  if (!populated?.tenant?.user) return;

  const payload = buildPayload(NOTIFICATION_TYPES.MANUAL_PAYMENT_RECORDED, {
    amount: `₹${populated.amount?.toLocaleString('en-IN')}`,
    method: populated.method || 'cash',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.MANUAL_PAYMENT_RECORDED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home/payments',
      entityType: 'Payment',
      entityId:   payment._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [populated.tenant.user] },
    isTransactional: true,
  });
});

// ─── Rent Triggers ────────────────────────────────────────────────────────────

/**
 * Notify tenant when a new rent record is generated.
 */
const onRentGenerated = safeTrigger('onRentGenerated', async (rentRecord) => {
  const RentRecord = require('../../models/RentRecord.model');
  const populated = await RentRecord.findById(rentRecord._id)
    .populate('tenant', 'user name')
    .lean();

  if (!populated?.tenant?.user) return;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthStr = `${months[populated.billingMonth - 1]} ${populated.billingYear}`;
  const dueDate  = new Date(populated.dueDate).toLocaleDateString('en-IN');

  const payload = buildPayload(NOTIFICATION_TYPES.RENT_GENERATED, {
    amount:  `₹${populated.totalAmount?.toLocaleString('en-IN')}`,
    month:   monthStr,
    dueDate,
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.RENT_GENERATED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home/payments',
      entityType: 'RentRecord',
      entityId:   rentRecord._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [populated.tenant.user] },
    isTransactional: true,
  });
});

// ─── Agreement Triggers ───────────────────────────────────────────────────────

/**
 * Notify tenant when an agreement is created.
 */
const onAgreementCreated = safeTrigger('onAgreementCreated', async (agreement) => {
  const Agreement = require('../../models/Agreement.model');
  const populated = await Agreement.findById(agreement._id)
    .populate('tenant', 'user')
    .populate('pg',     'name')
    .lean();

  if (!populated?.tenant?.user) return;

  const payload = buildPayload(NOTIFICATION_TYPES.AGREEMENT_CREATED, {
    pgName:          populated.pg?.name || 'your PG',
    agreementNumber: populated.agreementNumber,
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.AGREEMENT_CREATED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home/agreement',
      entityType: 'Agreement',
      entityId:   agreement._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [populated.tenant.user] },
    isTransactional: true,
  });
});

/**
 * Notify tenant when an agreement is renewed.
 */
const onAgreementRenewed = safeTrigger('onAgreementRenewed', async (agreement) => {
  const Agreement = require('../../models/Agreement.model');
  const populated = await Agreement.findById(agreement._id)
    .populate('tenant', 'user')
    .populate('pg',     'name')
    .lean();

  if (!populated?.tenant?.user) return;

  const payload = buildPayload(NOTIFICATION_TYPES.AGREEMENT_RENEWED, {
    pgName:  populated.pg?.name || 'your PG',
    endDate: new Date(populated.endDate).toLocaleDateString('en-IN'),
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.AGREEMENT_RENEWED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://tenant-home/agreement',
      entityType: 'Agreement',
      entityId:   agreement._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [populated.tenant.user] },
    isTransactional: true,
  });
});

// ─── Job Triggers ─────────────────────────────────────────────────────────────

/**
 * Notify all tenants (or city-based) when a new job is posted.
 */
const onJobPosted = safeTrigger('onJobPosted', async (jobPost) => {
  const payload = buildPayload(NOTIFICATION_TYPES.JOB_POSTED, {
    jobTitle: jobPost.title,
    pgName:   jobPost.pg?.name || 'a PG',
    role:     jobPost.role,
    city:     jobPost.city || '',
    salary:   jobPost.salaryMin ? jobPost.salaryMin.toLocaleString('en-IN') : 'Negotiable',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.JOB_POSTED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   `pginfo://jobs/${jobPost._id}`,
      entityType: 'JobPost',
      entityId:   jobPost._id.toString(),
    },
    audience:       { type: 'role', targetRoles: ['tenant'] },
    isTransactional: false,
  });
});

/**
 * Notify owner when someone applies to their job.
 */
const onJobApplicationReceived = safeTrigger('onJobApplicationReceived', async (application, jobPost) => {
  if (!jobPost?.owner) return;

  const payload = buildPayload(NOTIFICATION_TYPES.JOB_APPLICATION_RECEIVED, {
    applicantName: application.applicantName || 'Someone',
    jobTitle:      jobPost.title,
    pgName:        jobPost.pg?.name || 'your PG',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.JOB_APPLICATION_RECEIVED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://manage/hiring',
      entityType: 'JobApplication',
      entityId:   application._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [jobPost.owner] },
    isTransactional: false,
  });
});

/**
 * Notify applicant when their application status changes.
 */
const onJobApplicationStatusUpdated = safeTrigger('onJobApplicationStatusUpdated', async (application, jobPost) => {
  if (!application?.applicant) return; // no user account

  const payload = buildPayload(NOTIFICATION_TYPES.JOB_APPLICATION_STATUS, {
    jobTitle: jobPost?.title  || 'the job',
    pgName:   jobPost?.pg?.name || 'a PG',
    status:   application.status,
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.JOB_APPLICATION_STATUS,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   `pginfo://jobs/${jobPost?._id}`,
      entityType: 'JobApplication',
      entityId:   application._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [application.applicant] },
    isTransactional: false,
  });
});

// ─── Visit Triggers ───────────────────────────────────────────────────────────

/**
 * Notify PG owner when a visit is booked.
 */
const onVisitBooked = safeTrigger('onVisitBooked', async (visit, pg) => {
  if (!pg?.owner) return;

  const payload = buildPayload(NOTIFICATION_TYPES.VISIT_BOOKED, {
    name:      visit.name || 'A user',
    pgName:    pg.name,
    visitDate: visit.preferredDate
      ? new Date(visit.preferredDate).toLocaleDateString('en-IN')
      : 'Soon',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.VISIT_BOOKED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://visits',
      entityType: 'VisitRequest',
      entityId:   visit._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: [pg.owner] },
    isTransactional: false,
  });
});

// ─── Meetup Triggers ──────────────────────────────────────────────────────────

/**
 * Notify users in the meetup's city when a new meetup is created.
 */
const onMeetupCreated = safeTrigger('onMeetupCreated', async (meetup) => {
  const payload = buildPayload(NOTIFICATION_TYPES.MEETUP_CREATED, {
    meetupTitle: meetup.title,
    city:        meetup.city || '',
    date:        meetup.date ? new Date(meetup.date).toLocaleDateString('en-IN') : '',
    venue:       meetup.location || meetup.venue || '',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.MEETUP_CREATED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   `pginfo://meetup/${meetup._id}`,
      entityType: 'Meetup',
      entityId:   meetup._id.toString(),
    },
    audience:       { type: 'all' },
    isTransactional: false,
  });
});

// ─── System Triggers ──────────────────────────────────────────────────────────

/**
 * Notify new user with a welcome message.
 */
const onWelcome = safeTrigger('onWelcome', async (user) => {
  if (!user?._id) return;

  const payload = buildPayload(NOTIFICATION_TYPES.ACCOUNT_WELCOME, {
    name: user.name?.split(' ')[0] || 'there',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.ACCOUNT_WELCOME,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://home',
      entityType: null,
      entityId:   null,
    },
    audience:       { type: 'specific', targetUserIds: [user._id] },
    isTransactional: true,
  });
});

/**
 * Notify user when their role is upgraded.
 */
const onRoleUpgraded = safeTrigger('onRoleUpgraded', async (user, newRole) => {
  if (!user?._id) return;

  const payload = buildPayload(NOTIFICATION_TYPES.ROLE_UPGRADED, {});

  await createAndSend({
    type:  NOTIFICATION_TYPES.ROLE_UPGRADED,
    title: payload.title,
    body:  payload.body,
    data: {
      deepLink:   'pginfo://home',
      entityType: null,
      entityId:   null,
    },
    audience:       { type: 'specific', targetUserIds: [user._id] },
    isTransactional: true,
  });
});

/**
 * Notify all active tenants when a new meal menu is published for their PG.
 */
const onMealMenuPublished = safeTrigger('onMealMenuPublished', async (mealDoc, pg) => {
  if (!mealDoc?.pg) return;

  // Find all active tenants for this PG
  const tenants = await Tenant.find({
    pg: mealDoc.pg,
    status: { $in: ['active', 'notice'] },
    user: { $ne: null },
  }).select('user');

  const userIds = tenants.map(t => t.user).filter(Boolean);
  if (userIds.length === 0) return;

  const formattedDate = new Date(mealDoc.menuDate).toLocaleDateString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  await createAndSend({
    type:  NOTIFICATION_TYPES.MEAL_MENU_PUBLISHED || 'GENERAL_ALERT',
    title: '🍽️ Today\'s Menu Updated',
    body:  `New meal menu published for ${pg?.name || 'your PG'} (${formattedDate}). Check out what's serving!`,
    data: {
      deepLink:   'pginfo://tenant-meals',
      entityType: 'Meal',
      entityId:   mealDoc._id.toString(),
    },
    audience:       { type: 'specific', targetUserIds: userIds },
    isTransactional: false,
  });
});

/**
 * Notify tenant when payment receipt is generated.
 */
const onReceiptGenerated = safeTrigger('onReceiptGenerated', async (data) => {
  const { receiptUrl, amount, user } = data;
  if (!user) return;

  await createAndSend({
    type:  NOTIFICATION_TYPES.PAYMENT_RECEIPT || 'PAYMENT_SUCCESS',
    title: '🧾 Payment Receipt Available',
    body:  `Your payment receipt of ₹${Number(amount || 0).toLocaleString('en-IN')} is ready to view and download.`,
    data: {
      deepLink:   receiptUrl || 'pginfo://tenant-home',
      entityType: 'Payment',
      receiptUrl: receiptUrl || '',
    },
    audience:       { type: 'specific', targetUserIds: [user._id || user] },
    isTransactional: true,
  });
});

module.exports = {
  onPGApproved,
  onPGRejected,
  onPGLive,
  onTenantAdded,
  onBedAssigned,
  onTenantVacated,
  onPaymentSuccess,
  onPaymentFailed,
  onManualPaymentRecorded,
  onRentGenerated,
  onAgreementCreated,
  onAgreementRenewed,
  onJobPosted,
  onJobApplicationReceived,
  onJobApplicationStatusUpdated,
  onVisitBooked,
  onMeetupCreated,
  onWelcome,
  onRoleUpgraded,
  onMealMenuPublished,
  onReceiptGenerated,
};


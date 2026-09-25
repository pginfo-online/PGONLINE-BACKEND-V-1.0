const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const Payment    = require('../../models/Payment.model');
const RentRecord = require('../../models/RentRecord.model');
const Tenant     = require('../../models/Tenant.model');
const PG         = require('../../models/PG.model');
const User       = require('../../models/User.model');
const razorpayService = require('../../services/manage/razorpay.service');
const rentService     = require('../../services/manage/rent.service');
const receiptService  = require('../../services/manage/receipt.service');
const whatsappService = require('../../services/notification/whatsapp.service');
const emailService    = require('../../services/notification/email.service');
const crypto = require('crypto');
const notificationTrigger = require('../../services/notification/notification.trigger');
const { logger } = require('../../utils/logger');

/**
 * Create a Razorpay order for a rent payment (Web only for now).
 *
 * Flow: Frontend calls this → gets orderId → opens Razorpay checkout → calls verify
 */
exports.createOrder = asyncHandler(async (req, res) => {
  const { rentRecordId, amount, type = 'rent', description } = req.body;

  // Validate the rent record if provided
  let rentRecord = null;
  let tenant     = null;
  let pg         = null;

  if (rentRecordId) {
    rentRecord = await RentRecord.findById(rentRecordId);
    if (!rentRecord) return errorResponse(res, 'Rent record not found', 404);

    if (rentRecord.status === 'paid' || rentRecord.status === 'waived') {
      return errorResponse(res, `Rent record is already ${rentRecord.status}`, 400);
    }

    tenant = await Tenant.findById(rentRecord.tenant);
    pg     = await PG.findById(rentRecord.pg);

    // Verify the requesting user is either the owner or the linked tenant
    const isOwner  = pg && pg.owner.toString() === req.user._id.toString();
    const isTenant = tenant && tenant.user && tenant.user.toString() === req.user._id.toString();
    if (!isOwner && !isTenant) {
      return errorResponse(res, 'Not authorized to make this payment', 403);
    }
  } else {
    // Generic payment (security deposit, etc.) — owner must provide pgId
    if (!req.body.pgId) return errorResponse(res, 'pgId is required for non-rent payments', 400);
    pg = await PG.findById(req.body.pgId);
    if (!pg) return errorResponse(res, 'PG not found', 404);
  }

  // Amount in paise (₹1 = 100 paise)
  const amountInPaise = Math.round((amount || (rentRecord ? rentRecord.totalAmount - rentRecord.paidAmount : 0)) * 100);
  if (amountInPaise < 100) return errorResponse(res, 'Minimum payment is ₹1', 400);

  // Idempotency key
  const idempotencyKey = rentRecordId
    ? `rent_${rentRecordId}_${Date.now()}`
    : `pay_${req.body.pgId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  // Create Razorpay order
  const order = await razorpayService.createOrder({
    amount:   amountInPaise,
    currency: 'INR',
    receipt:  idempotencyKey,
    notes: {
      type,
      pgId:         pg?._id?.toString(),
      tenantId:     tenant?._id?.toString(),
      rentRecordId: rentRecordId || '',
    },
  });

  // Save payment record
  const payment = await Payment.create({
    tenant:           tenant?._id || null,
    pg:               pg._id,
    owner:            pg.owner,
    rentRecord:       rentRecord?._id || null,
    type,
    description:      description || `${type} payment`,
    razorpayOrderId:  order.id,
    amount:           amountInPaise / 100,
    currency:         'INR',
    status:           'created',
    method:           'razorpay',
    idempotencyKey,
    initiatedBy:      req.user._id,
  });

  return successResponse(res, 'Payment order created', {
    orderId:    order.id,
    amount:     order.amount,
    currency:   order.currency,
    paymentId:  payment._id,
    keyId:      process.env.RAZORPAY_KEY_ID, // public key only
  }, 201);
});

/**
 * Verify Razorpay payment after checkout completes.
 *
 * Frontend sends: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return errorResponse(res, 'Missing payment verification fields', 400);
  }

  // Verify signature
  const isValid = razorpayService.verifyPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValid) {
    return errorResponse(res, 'Payment signature verification failed', 400);
  }

  // Find the payment record
  const payment = await Payment.findOne({ razorpayOrderId });
  if (!payment) return errorResponse(res, 'Payment record not found', 404);

  if (payment.status === 'paid') {
    return successResponse(res, 'Payment already verified', payment);
  }

  // Update payment record
  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  payment.status            = 'paid';
  payment.paidAt            = new Date();
  await payment.save();

  // If linked to a rent record, update rent
  if (payment.rentRecord) {
    await rentService.recordPayment(payment.rentRecord, payment.amount, {
      method:    'online',
      reference: razorpayPaymentId,
      notes:     'Razorpay online payment',
    });
  }

  notificationTrigger.onPaymentSuccess(payment).catch(() => {});
  return successResponse(res, 'Payment verified successfully', payment);
});

/**
 * Razorpay webhook handler.
 *
 * Razorpay sends POST with X-Razorpay-Signature header.
 * We verify the webhook signature independently and process idempotently.
 */
exports.handleWebhook = asyncHandler(async (req, res) => {
  const webhookSignature = req.headers['x-razorpay-signature'];
  const rawBody          = req.rawBody; // must be captured by express middleware

  if (!webhookSignature || !rawBody) {
    return errorResponse(res, 'Invalid webhook request', 400);
  }

  const isValid = razorpayService.verifyWebhookSignature(rawBody, webhookSignature);
  if (!isValid) {
    return errorResponse(res, 'Webhook signature verification failed', 400);
  }

  const event = req.body;
  const eventType = event.event;

  // Handle payment.captured event
  if (eventType === 'payment.captured') {
    const paymentEntity = event.payload?.payment?.entity;
    if (!paymentEntity) return successResponse(res, 'No payment entity in webhook');

    const orderId   = paymentEntity.order_id;
    const paymentId = paymentEntity.id;

    // Find payment record
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    if (!payment) return successResponse(res, 'Payment record not found, ignoring');

    // Idempotency check
    if (payment.webhookProcessed) {
      return successResponse(res, 'Webhook already processed');
    }

    // Update only if not already paid via verify
    if (payment.status !== 'paid') {
      payment.razorpayPaymentId = paymentId;
      payment.status            = 'paid';
      payment.paidAt            = new Date();

      // Update rent record if linked
      if (payment.rentRecord) {
        await rentService.recordPayment(payment.rentRecord, payment.amount, {
          method:    'online',
          reference: paymentId,
          notes:     'Razorpay webhook payment capture',
        });
      }
    }

    payment.webhookProcessed   = true;
    payment.webhookProcessedAt = new Date();
    payment.gatewayResponse    = paymentEntity;
    await payment.save();
    notificationTrigger.onPaymentSuccess(payment).catch(() => {});
  }

  // Handle payment.failed
  if (eventType === 'payment.failed') {
    const paymentEntity = event.payload?.payment?.entity;
    if (paymentEntity?.order_id) {
      const failedPayment = await Payment.findOneAndUpdate(
        { razorpayOrderId: paymentEntity.order_id },
        { status: 'failed', webhookProcessed: true, webhookProcessedAt: new Date() },
        { new: true }
      );
      if (failedPayment) notificationTrigger.onPaymentFailed(failedPayment).catch(() => {});
    }
  }

  // Always respond 200 to Razorpay
  return successResponse(res, 'Webhook processed');
});

/**
 * List payments for a PG (owner view).
 */
exports.getPayments = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = { pg: pgId, owner: ownerId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.type)   filter.type   = req.query.type;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate('tenant', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    message: 'Payments fetched',
    data:    payments,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/**
 * Record a manual (cash/UPI/bank) payment.
 */
exports.recordManualPayment = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const { tenantId, rentRecordId, amount, method, type = 'rent', reference, description, notes } = req.body;
  if (!amount || amount <= 0) return errorResponse(res, 'Valid amount is required', 400);

  const idempotencyKey = `manual_${pgId}_${tenantId || 'none'}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const payment = await Payment.create({
    tenant:        tenantId || null,
    pg:            pgId,
    owner:         ownerId,
    rentRecord:    rentRecordId || null,
    type,
    description:   description || `Manual ${type} payment`,
    amount,
    currency:      'INR',
    status:        'paid',
    method:        method || 'cash',
    idempotencyKey,
    initiatedBy:   req.user._id,
    paidAt:        new Date(),
    notes,
  });

  // If linked to a rent record, update it
  if (rentRecordId) {
    await rentService.recordPayment(rentRecordId, amount, {
      method: method || 'cash',
      reference: reference || payment._id.toString(),
      notes,
    });
  }

  notificationTrigger.onManualPaymentRecorded(payment).catch(() => {});
  return successResponse(res, 'Manual payment recorded', payment, 201);
});

/**
 * Refund a payment (Full or Partial).
 * Supports Razorpay automated refunds and manual offline refunds.
 */
exports.refundPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, owner: req.user._id });
  if (!payment) return errorResponse(res, 'Payment not found or access denied', 404);

  if (payment.status === 'refunded') {
    return errorResponse(res, 'Payment is already fully refunded', 400);
  }

  const refundAmount = req.body.amount ? Number(req.body.amount) : payment.amount;
  if (!refundAmount || refundAmount <= 0 || refundAmount > payment.amount) {
    return errorResponse(res, `Refund amount must be between ₹1 and ₹${payment.amount}`, 400);
  }

  let razorpayRefund = null;

  // If paid online via Razorpay, trigger Razorpay refund API
  if (payment.method === 'razorpay' && payment.razorpayPaymentId) {
    try {
      razorpayRefund = await razorpayService.createRefund(
        payment.razorpayPaymentId,
        refundAmount * 100, // in paise
        { reason: req.body.reason || 'Customer request' }
      );
    } catch (err) {
      logger.error(`[Refund] Razorpay refund failed: ${err.message}`);
      return errorResponse(res, `Razorpay refund failed: ${err.message}`, 500);
    }
  }

  // Update payment status
  const isFullRefund = refundAmount >= payment.amount;
  payment.status = isFullRefund ? 'refunded' : 'partially_refunded';
  payment.notes = (payment.notes ? `${payment.notes}\n` : '') +
    `Refunded ₹${refundAmount} on ${new Date().toISOString()}. Reason: ${req.body.reason || 'N/A'}`;
  await payment.save();

  // If payment was linked to a RentRecord, adjust rent record
  if (payment.rentRecord) {
    const record = await RentRecord.findById(payment.rentRecord);
    if (record) {
      record.paidAmount = Math.max(0, record.paidAmount - refundAmount);
      record.status = record.paidAmount >= record.totalAmount ? 'paid' : (record.paidAmount > 0 ? 'partial' : 'pending');
      record.paymentHistory.push({
        amount: -refundAmount,
        paidAt: new Date(),
        method: payment.method || 'cash',
        reference: razorpayRefund?.id || `refund_${Date.now()}`,
        notes: `Refund: ${req.body.reason || 'Payment refunded'}`,
      });
      await record.save();
    }
  }

  return successResponse(res, 'Payment refunded successfully', {
    paymentId: payment._id,
    refundAmount,
    status: payment.status,
    razorpayRefundId: razorpayRefund?.id || null,
  });
});

/**
 * Get Receipt for a payment.
 */
exports.getReceipt = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate('tenant')
    .populate('pg');

  if (!payment) return errorResponse(res, 'Payment not found', 404);

  const isOwner = payment.owner.toString() === req.user._id.toString();
  const isTenant = payment.tenant?.user && payment.tenant.user.toString() === req.user._id.toString();
  if (!isOwner && !isTenant) {
    return errorResponse(res, 'Not authorized to access this receipt', 403);
  }

  // If linked to rent record with existing invoice
  if (payment.rentRecord) {
    const rentRecord = await RentRecord.findById(payment.rentRecord);
    if (rentRecord?.invoiceUrl) {
      return successResponse(res, 'Receipt fetched', {
        receiptUrl: rentRecord.invoiceUrl,
        invoiceNumber: rentRecord.invoiceNumber,
      });
    }
  }

  // Generate on demand
  const owner = await User.findById(payment.owner);
  const receiptResult = await receiptService.generateAndStoreReceipt({
    tenantName:    payment.tenant?.name || 'Tenant',
    tenantPhone:   payment.tenant?.phone || '',
    pgName:        payment.pg?.name || '',
    pgAddress:     payment.pg?.address || '',
    ownerName:     owner?.name || '',
    billingMonth:  new Date(payment.createdAt).getMonth() + 1,
    billingYear:   new Date(payment.createdAt).getFullYear(),
    rentAmount:    payment.amount,
    paidAmount:    payment.amount,
    paymentMethod: payment.method || 'online',
    reference:     payment.razorpayPaymentId || payment._id.toString(),
  });

  return successResponse(res, 'Receipt generated', {
    receiptUrl: receiptResult.receiptUrl,
    invoiceNumber: receiptResult.receiptNumber,
  });
});

/**
 * Generate Razorpay payment link directly for any payment (rent, deposit, charges).
 */
exports.createPaymentLink = asyncHandler(async (req, res) => {
  const { tenantId, rentRecordId, amount, description, sendWhatsApp = true, sendEmail = true } = req.body;
  const ownerId = req.user._id;

  let tenant = null;
  let rentRecord = null;
  let pg = null;

  if (tenantId) {
    tenant = await Tenant.findOne({ _id: tenantId, owner: ownerId }).populate('pg');
    if (!tenant) return errorResponse(res, 'Tenant not found or access denied', 404);
    pg = tenant.pg;
  }

  if (rentRecordId) {
    rentRecord = await RentRecord.findOne({ _id: rentRecordId, owner: ownerId }).populate('pg').populate('tenant');
    if (!rentRecord) return errorResponse(res, 'Rent record not found or access denied', 404);
    tenant = tenant || rentRecord.tenant;
    pg = pg || rentRecord.pg;
  }

  const payAmount = Number(amount || (rentRecord ? rentRecord.totalAmount - rentRecord.paidAmount : 0));
  if (!payAmount || payAmount <= 0) {
    return errorResponse(res, 'Valid payment amount is required', 400);
  }

  try {
    const paymentLink = await razorpayService.createPaymentLink({
      amount: Math.round(payAmount * 100), // in paise
      description: description || `Payment for ${pg?.name || 'PG'}`,
      customer: {
        name:    tenant?.name || 'Tenant',
        email:   tenant?.email || undefined,
        contact: tenant?.phone || undefined,
      },
      notes: {
        ownerId:      ownerId.toString(),
        pgId:         pg?._id?.toString() || '',
        tenantId:     tenant?._id?.toString() || '',
        rentRecordId: rentRecord?._id?.toString() || '',
      },
    });

    // If linked to rent record, store on it
    if (rentRecord) {
      await rentService.setPaymentLink(rentRecord._id, paymentLink.short_url, paymentLink.id);
    }

    // Optionally notify via WhatsApp
    if (sendWhatsApp && tenant?.phone) {
      whatsappService.sendRentReminder(tenant.phone, {
        tenantName:  tenant.name,
        amount:      String(payAmount),
        dueDate:     rentRecord?.dueDate ? new Date(rentRecord.dueDate).toLocaleDateString('en-IN') : 'Immediately',
        paymentLink: paymentLink.short_url,
        pgName:      pg?.name || 'PG',
      }).catch((e) => logger.warn(`[PaymentLink] WhatsApp notification failed: ${e.message}`));
    }

    // Optionally notify via Email
    if (sendEmail && tenant?.email) {
      emailService.sendRentReminderEmail(tenant.email, {
        tenantName:   tenant.name,
        amount:       payAmount,
        dueDate:      rentRecord?.dueDate ? new Date(rentRecord.dueDate).toLocaleDateString('en-IN') : 'Immediately',
        billingMonth: rentRecord?.billingMonth || new Date().getMonth() + 1,
        billingYear:  rentRecord?.billingYear || new Date().getFullYear(),
        paymentLink:  paymentLink.short_url,
        pgName:       pg?.name || 'PG',
      }).catch((e) => logger.warn(`[PaymentLink] Email notification failed: ${e.message}`));
    }

    return successResponse(res, 'Payment link created successfully', {
      paymentLink:   paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      amount:        payAmount,
    });
  } catch (err) {
    logger.error(`[PaymentLink] Failed to create payment link: ${err.message}`);
    return errorResponse(res, `Failed to create payment link: ${err.message}`, 500);
  }
});

const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const Payment    = require('../../models/Payment.model');
const RentRecord = require('../../models/RentRecord.model');
const Tenant     = require('../../models/Tenant.model');
const PG         = require('../../models/PG.model');
const razorpayService = require('../../services/manage/razorpay.service');
const rentService     = require('../../services/manage/rent.service');
const crypto = require('crypto');

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
  }

  // Handle payment.failed
  if (eventType === 'payment.failed') {
    const paymentEntity = event.payload?.payment?.entity;
    if (paymentEntity?.order_id) {
      await Payment.findOneAndUpdate(
        { razorpayOrderId: paymentEntity.order_id },
        { status: 'failed', webhookProcessed: true, webhookProcessedAt: new Date() }
      );
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

  return successResponse(res, 'Manual payment recorded', payment, 201);
});

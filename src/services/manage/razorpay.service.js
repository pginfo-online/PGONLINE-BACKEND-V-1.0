const Razorpay = require('razorpay');
const crypto = require('crypto');

/**
 * Razorpay Service
 *
 * Security principles:
 * - Orders are ALWAYS created server-side
 * - Signatures are ALWAYS verified server-side using HMAC-SHA256
 * - Secret keys are NEVER exposed to client
 * - Webhook events are verified independently
 */

// ─── Lazy Razorpay Instance Getter ───────────────────────────────────────────
const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error('Razorpay API keys (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are missing in server environment variables.');
  }

  return new Razorpay({ key_id, key_secret });
};

/**
 * Create a Razorpay order (server-side only).
 * @param {number} amount - Amount in paise (₹1 = 100 paise)
 * @param {string} currency - Currency code, default 'INR'
 * @param {string} receipt - Your internal reference ID
 * @param {object} notes - Metadata attached to the order
 */
const createOrder = async ({ amount, currency = 'INR', receipt, notes = {} }) => {
  if (!amount || amount < 100) {
    throw new Error('Minimum order amount is ₹1 (100 paise)');
  }

  const razorpay = getRazorpayInstance();
  const order = await razorpay.orders.create({
    amount:   Math.round(amount), // must be integer paise
    currency,
    receipt,
    notes,
  });

  return order;
};

/**
 * Verify Razorpay payment signature.
 * MUST be called server-side after payment completion.
 *
 * Signature algorithm: HMAC-SHA256 of `orderId|paymentId` using webhook secret
 *
 * @param {string} razorpayOrderId
 * @param {string} razorpayPaymentId
 * @param {string} razorpaySignature - received from client
 * @returns {boolean}
 */
const verifyPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
};

/**
 * Verify Razorpay webhook signature.
 * Called when a webhook event arrives.
 *
 * @param {string} rawBody - Raw request body string (NOT parsed JSON)
 * @param {string} webhookSignature - X-Razorpay-Signature header value
 * @returns {boolean}
 */
const verifyWebhookSignature = (rawBody, webhookSignature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === webhookSignature;
};

/**
 * Fetch payment details from Razorpay API.
 * Used to double-check payment status after webhook.
 *
 * @param {string} paymentId
 */
const fetchPayment = async (paymentId) => {
  const razorpay = getRazorpayInstance();
  return await razorpay.payments.fetch(paymentId);
};

/**
 * Initiate a refund for a payment.
 * @param {string} paymentId
 * @param {number} amount - Amount to refund in paise (null = full refund)
 * @param {object} notes
 */
const createRefund = async (paymentId, amount = null, notes = {}) => {
  const params = { notes };
  if (amount) params.amount = Math.round(amount);
  const razorpay = getRazorpayInstance();
  return await razorpay.payments.refund(paymentId, params);
};

module.exports = {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  createRefund,
};

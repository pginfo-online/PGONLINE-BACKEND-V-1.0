const { Resend } = require('resend');
const { logger } = require('../../utils/logger');

/**
 * Email Service — Resend Integration
 *
 * Production-grade transactional email service for:
 * - Rent reminders
 * - Payment confirmations
 * - Receipt delivery
 * - Welcome emails
 * - Lease expiry reminders
 *
 * Environment variables:
 *   RESEND_API_KEY       — Resend API key
 *   EMAIL_FROM_ADDRESS   — Sender email (default: noreply@pginfo.online)
 *   EMAIL_FROM_NAME      — Sender name (default: PGInfo.online)
 */

let resendInstance = null;

const getResend = () => {
  if (resendInstance) return resendInstance;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  resendInstance = new Resend(apiKey);
  return resendInstance;
};

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@pginfo.online';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'PGInfo.online';
const FROM = `${FROM_NAME} <${FROM_ADDRESS}>`;

/**
 * Send a transactional email.
 *
 * @param {object} opts
 * @param {string} opts.to       — Recipient email
 * @param {string} opts.subject  — Email subject
 * @param {string} opts.html     — HTML body
 * @param {string} [opts.text]   — Plain text fallback
 * @param {Array}  [opts.attachments] — File attachments
 * @param {string} [opts.replyTo] — Reply-to address
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
const sendEmail = async ({ to, subject, html, text, attachments, replyTo }) => {
  try {
    if (!to || !subject) {
      return { success: false, error: 'Missing required fields: to, subject' };
    }

    const resend = getResend();

    const payload = {
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || undefined,
      attachments: attachments || undefined,
      reply_to: replyTo || undefined,
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      logger.error(`[Email] Failed to send to ${to}: ${error.message}`);
      return { success: false, error: error.message };
    }

    logger.info(`[Email] Sent "${subject}" to ${to} → id: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error(`[Email] Exception sending to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

// ─── Template Builders ──────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Build HTML for rent reminder email.
 */
const buildRentReminderHtml = ({ tenantName, pgName, roomNumber, amount, dueDate, paymentLink }) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;color:#fff">
      <h1 style="margin:0;font-size:20px;font-weight:700">Rent Payment Reminder</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px">PGInfo.online</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#374151;font-size:15px">Hello <strong>${tenantName}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px">This is a friendly reminder that your PG rent is due soon.</p>
      <div style="background:#F3F4F6;border-radius:8px;padding:16px 20px;margin:0 0 20px">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
          <tr><td style="padding:6px 0;color:#6B7280">PG</td><td style="padding:6px 0;text-align:right;font-weight:600">${pgName}</td></tr>
          ${roomNumber ? `<tr><td style="padding:6px 0;color:#6B7280">Room</td><td style="padding:6px 0;text-align:right;font-weight:600">${roomNumber}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#6B7280">Amount Due</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#DC2626;font-size:16px">₹${Number(amount).toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Due Date</td><td style="padding:6px 0;text-align:right;font-weight:600">${dueDate}</td></tr>
        </table>
      </div>
      ${paymentLink ? `
      <div style="text-align:center;margin:24px 0 20px">
        <a href="${paymentLink}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;box-shadow:0 2px 8px rgba(79,70,229,0.3)">Pay Rent Online</a>
      </div>
      ` : ''}
      <p style="margin:0;color:#6B7280;font-size:13px">Please ensure timely payment to avoid late fees.</p>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;text-align:center">
      <p style="margin:0;color:#9CA3AF;font-size:11px">This is an automated message from PGInfo.online</p>
    </div>
  </div>
</body>
</html>`;

/**
 * Build HTML for payment confirmation email.
 */
const buildPaymentConfirmationHtml = ({ tenantName, pgName, roomNumber, amount, paymentMethod, paymentDate, receiptNo, receiptNumber, receiptUrl }) => {
  const rNo = receiptNumber || receiptNo || '—';
  const pDate = paymentDate || new Date().toLocaleDateString('en-IN');
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#059669,#10B981);padding:28px 32px;color:#fff">
      <h1 style="margin:0;font-size:20px;font-weight:700">✅ Payment Received</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px">PGInfo.online</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#374151;font-size:15px">Hello <strong>${tenantName}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px">Your payment has been received successfully!</p>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px 20px;margin:0 0 20px">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
          <tr><td style="padding:6px 0;color:#6B7280">PG</td><td style="padding:6px 0;text-align:right;font-weight:600">${pgName}</td></tr>
          ${roomNumber ? `<tr><td style="padding:6px 0;color:#6B7280">Room</td><td style="padding:6px 0;text-align:right;font-weight:600">${roomNumber}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#6B7280">Amount Paid</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#059669;font-size:16px">₹${Number(amount).toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Method</td><td style="padding:6px 0;text-align:right;font-weight:600">${(paymentMethod || 'cash').toUpperCase()}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Date</td><td style="padding:6px 0;text-align:right;font-weight:600">${pDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Receipt #</td><td style="padding:6px 0;text-align:right;font-weight:600">${rNo}</td></tr>
        </table>
      </div>
      ${receiptUrl ? `
      <div style="text-align:center;margin:20px 0 24px">
        <a href="${receiptUrl}" style="display:inline-block;background:#059669;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Download Receipt PDF</a>
      </div>
      ` : ''}
      <p style="margin:0;color:#6B7280;font-size:13px">Thank you for the timely payment!</p>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;text-align:center">
      <p style="margin:0;color:#9CA3AF;font-size:11px">This is an automated message from PGInfo.online</p>
    </div>
  </div>
</body>
</html>`;
};

/**
 * Build HTML for welcome tenant email.
 */
const buildWelcomeTenantHtml = ({ tenantName, pgName, roomNumber, bedLabel, joinDate, monthlyRent }) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#4F46E5,#6366F1);padding:28px 32px;color:#fff">
      <h1 style="margin:0;font-size:20px;font-weight:700">🎉 Welcome!</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px">PGInfo.online</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#374151;font-size:15px">Hello <strong>${tenantName}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px">Welcome to your new home! Here are your tenancy details:</p>
      <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:8px;padding:16px 20px;margin:0 0 20px">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
          <tr><td style="padding:6px 0;color:#6B7280">PG</td><td style="padding:6px 0;text-align:right;font-weight:600">${pgName}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Room</td><td style="padding:6px 0;text-align:right;font-weight:600">${roomNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Bed</td><td style="padding:6px 0;text-align:right;font-weight:600">${bedLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Join Date</td><td style="padding:6px 0;text-align:right;font-weight:600">${joinDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Monthly Rent</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#4F46E5;font-size:16px">₹${Number(monthlyRent).toLocaleString('en-IN')}</td></tr>
        </table>
      </div>
      <p style="margin:0;color:#6B7280;font-size:13px">If you have any questions, feel free to reach out to the management.</p>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;text-align:center">
      <p style="margin:0;color:#9CA3AF;font-size:11px">This is an automated message from PGInfo.online</p>
    </div>
  </div>
</body>
</html>`;

// ─── Convenience Send Methods ───────────────────────────────────────────────

const sendRentReminderEmail = async (to, data) => {
  return sendEmail({
    to,
    subject: `Rent Reminder — ₹${Number(data.amount).toLocaleString('en-IN')} due on ${data.dueDate}`,
    html: buildRentReminderHtml(data),
  });
};

const sendPaymentConfirmationEmail = async (to, data) => {
  return sendEmail({
    to,
    subject: `Payment Confirmed — ₹${Number(data.amount).toLocaleString('en-IN')} received`,
    html: buildPaymentConfirmationHtml(data),
  });
};

const sendWelcomeTenantEmail = async (to, data) => {
  return sendEmail({
    to,
    subject: `Welcome to ${data.pgName}! Your tenancy details`,
    html: buildWelcomeTenantHtml(data),
  });
};

const sendReceiptEmail = async (to, { tenantName, receiptUrl, amount, billingMonth, billingYear }) => {
  const monthName = MONTH_NAMES[(billingMonth || 1) - 1] || 'Unknown';
  return sendEmail({
    to,
    subject: `Rent Receipt — ${monthName} ${billingYear}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#059669,#10B981);padding:28px 32px;color:#fff">
      <h1 style="margin:0;font-size:20px;font-weight:700">🧾 Rent Receipt</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px">PGInfo.online</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#374151;font-size:15px">Hello <strong>${tenantName}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px">Your rent receipt for <strong>${monthName} ${billingYear}</strong> (₹${Number(amount).toLocaleString('en-IN')}) is ready.</p>
      <a href="${receiptUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Download Receipt</a>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;text-align:center">
      <p style="margin:0;color:#9CA3AF;font-size:11px">This is an automated message from PGInfo.online</p>
    </div>
  </div>
</body>
</html>`,
  });
};

module.exports = {
  sendEmail,
  sendRentReminderEmail,
  sendPaymentConfirmationEmail,
  sendWelcomeTenantEmail,
  sendReceiptEmail,
  buildRentReminderHtml,
  buildPaymentConfirmationHtml,
  buildWelcomeTenantHtml,
};

const PDFDocument = require('pdfkit');
const cloudinary  = require('cloudinary').v2;
const stream      = require('stream');
const Payment     = require('../../models/Payment.model');

/**
 * Receipt Service
 *
 * Generates professional PDF payment receipts using pdfkit
 * and uploads them to Cloudinary.
 *
 * Design: fire-and-forget from rent.controller / payment.controller.
 * Receipt URL is stored on the Payment document and tenant is notified.
 */

// ─── Generate a unique receipt number ─────────────────────────────────────────
const generateReceiptNumber = async () => {
  const year  = new Date().getFullYear();
  const count = await Payment.countDocuments({ receiptNumber: { $ne: null } });
  const seq   = String(count + 1).padStart(6, '0');
  return `RCP-${year}-${seq}`;
};

// ─── Build PDF buffer ──────────────────────────────────────────────────────────
const buildReceiptPDF = (data) => {
  return new Promise((resolve, reject) => {
    const {
      receiptNumber,
      paymentDate,
      tenantName,
      tenantPhone,
      pgName,
      pgAddress,
      billingMonth,
      billingYear,
      rentAmount,
      paidAmount,
      paymentMethod,
      reference,
      ownerName,
    } = data;

    const doc     = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('error', reject);
    doc.on('end',   () => resolve(Buffer.concat(buffers)));

    const PRIMARY   = '#4F46E5';
    const DARK      = '#111827';
    const GRAY      = '#6B7280';
    const LIGHT_BG  = '#F9FAFB';
    const GREEN     = '#059669';
    const PAGE_W    = doc.page.width - 100; // usable width

    // ── Header background strip ──────────────────────────────────
    doc.rect(0, 0, doc.page.width, 120).fill(PRIMARY);

    // ── Logo / Brand ──────────────────────────────────────────────
    doc
      .fillColor('#FFFFFF')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('PGInfo.online', 50, 30)
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#C7D2FE')
      .text('Payment Receipt', 50, 58)
      .fontSize(10)
      .fillColor('#FFFFFF')
      .text(`Receipt #: ${receiptNumber}`, 50, 76)
      .text(`Date: ${paymentDate}`, 50, 92);

    // ── PAID stamp ───────────────────────────────────────────────
    doc
      .fontSize(28)
      .font('Helvetica-Bold')
      .fillColor('#86EFAC')
      .text('✓ PAID', doc.page.width - 160, 40, { width: 130, align: 'right' });

    // ── Move below header ─────────────────────────────────────────
    doc.moveDown(4);
    const y0 = 145;

    // ── Billed To / From cards ────────────────────────────────────
    const cardH = 90;
    const cardW = (PAGE_W / 2) - 5;

    // Left card: Billed To
    doc.rect(50, y0, cardW, cardH).fill(LIGHT_BG);
    doc
      .fillColor(GRAY).fontSize(9).font('Helvetica-Bold')
      .text('BILLED TO', 62, y0 + 12)
      .fillColor(DARK).fontSize(12).font('Helvetica-Bold')
      .text(tenantName || 'Tenant', 62, y0 + 28, { width: cardW - 24 })
      .fillColor(GRAY).fontSize(10).font('Helvetica')
      .text(tenantPhone || '', 62, y0 + 46)
      .text(pgName || '', 62, y0 + 62, { width: cardW - 24 });

    // Right card: Received By
    const x2 = 50 + cardW + 10;
    doc.rect(x2, y0, cardW, cardH).fill(LIGHT_BG);
    doc
      .fillColor(GRAY).fontSize(9).font('Helvetica-Bold')
      .text('RECEIVED BY', x2 + 12, y0 + 12)
      .fillColor(DARK).fontSize(12).font('Helvetica-Bold')
      .text(ownerName || 'PG Owner', x2 + 12, y0 + 28, { width: cardW - 24 })
      .fillColor(GRAY).fontSize(10).font('Helvetica')
      .text(pgName || '', x2 + 12, y0 + 46, { width: cardW - 24 })
      .text(pgAddress || '', x2 + 12, y0 + 62, { width: cardW - 24 });

    // ── Payment Details table ──────────────────────────────────────
    const tableY = y0 + cardH + 30;
    doc
      .fillColor(DARK).fontSize(13).font('Helvetica-Bold')
      .text('Payment Details', 50, tableY);

    const rows = [
      ['Billing Period',   billingMonth && billingYear ? `${new Date(2000, billingMonth - 1).toLocaleString('en', { month: 'long' })} ${billingYear}` : 'N/A'],
      ['Rent Amount',      `₹${Number(rentAmount || 0).toLocaleString('en-IN')}`],
      ['Amount Paid',      `₹${Number(paidAmount || 0).toLocaleString('en-IN')}`],
      ['Payment Method',   (paymentMethod || 'cash').replace('_', ' ').toUpperCase()],
      ['Reference / ID',   reference || '—'],
    ];

    const rowH   = 32;
    const col1W  = 180;
    const col2X  = 50 + col1W + 20;
    let   rowY   = tableY + 26;

    rows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : LIGHT_BG;
      doc.rect(50, rowY, PAGE_W, rowH).fill(bg);
      doc
        .fillColor(GRAY).fontSize(10).font('Helvetica-Bold')
        .text(label, 62, rowY + 9, { width: col1W })
        .fillColor(DARK).fontSize(10).font('Helvetica')
        .text(value, col2X, rowY + 9, { width: PAGE_W - col1W - 30 });
      rowY += rowH;
    });

    // ── Total Paid box ─────────────────────────────────────────────
    const totalBoxY = rowY + 20;
    doc.rect(50, totalBoxY, PAGE_W, 50).fill(GREEN);
    doc
      .fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold')
      .text('Total Amount Paid', 62, totalBoxY + 12)
      .fontSize(16)
      .text(`₹${Number(paidAmount || 0).toLocaleString('en-IN')}`, 62, totalBoxY + 12,
        { width: PAGE_W - 24, align: 'right' });

    // ── Note ──────────────────────────────────────────────────────
    const noteY = totalBoxY + 70;
    doc
      .fillColor(GRAY).fontSize(9).font('Helvetica')
      .text(
        'This is a computer-generated receipt and does not require a physical signature.',
        50, noteY, { width: PAGE_W, align: 'center' }
      );

    // ── Footer ────────────────────────────────────────────────────
    doc
      .fontSize(8).fillColor('#D1D5DB')
      .text(
        `Generated by PGInfo.online • ${new Date().toLocaleString('en-IN')}`,
        50, doc.page.height - 40,
        { align: 'center', width: PAGE_W }
      );

    doc.end();
  });
};

// ─── Upload PDF buffer to Cloudinary ──────────────────────────────────────────
const uploadToCloudinary = (pdfBuffer, receiptNumber) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:        'pginfo/receipts',
        resource_type: 'auto',
        public_id:     `receipt_${receiptNumber}`,
        overwrite:     true,
        format:        'pdf',
      },
      (error, result) => {
        if (error) reject(error);
        else       resolve(result);
      }
    );
    const readable = new stream.PassThrough();
    readable.end(pdfBuffer);
    readable.pipe(uploadStream);
  });
};

// ─── Main orchestrator — called fire-and-forget from rent.controller ───────────
const generateAndStoreReceipt = async ({
  paymentId,
  tenantName,
  tenantPhone,
  pgName,
  pgAddress,
  ownerName,
  billingMonth,
  billingYear,
  rentAmount,
  paidAmount,
  paymentMethod,
  reference,
}) => {
  try {
    const receiptNumber = await generateReceiptNumber();
    const paymentDate   = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const pdfBuffer = await buildReceiptPDF({
      receiptNumber,
      paymentDate,
      tenantName,
      tenantPhone,
      pgName,
      pgAddress,
      ownerName,
      billingMonth,
      billingYear,
      rentAmount,
      paidAmount,
      paymentMethod,
      reference,
    });

    const uploadResult = await uploadToCloudinary(pdfBuffer, receiptNumber);

    // Persist receipt URL on the Payment document if paymentId passed
    if (paymentId) {
      await Payment.findByIdAndUpdate(paymentId, {
        receiptUrl:      uploadResult.secure_url,
        receiptPublicId: uploadResult.public_id,
        receiptNumber,
      });
    }

    return {
      receiptUrl:    uploadResult.secure_url,
      receiptNumber,
    };
  } catch (err) {
    console.error(`[ReceiptService] Failed to generate receipt: ${err.message}`);
    return null;
  }
};

module.exports = { generateAndStoreReceipt, buildReceiptPDF, generateReceiptNumber };

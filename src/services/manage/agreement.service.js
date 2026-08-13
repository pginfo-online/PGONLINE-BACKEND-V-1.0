const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const streamifier = require('stream');
const Agreement = require('../../models/Agreement.model');

/**
 * Agreement Service
 * Handles agreement number generation and PDF creation via pdfkit.
 */

/**
 * Generate a unique agreement number.
 * Format: AGR-YYYY-XXXXXX (e.g. AGR-2026-000001)
 */
const generateAgreementNumber = async () => {
  const year = new Date().getFullYear();
  const count = await Agreement.countDocuments();
  const sequence = String(count + 1).padStart(6, '0');
  return `AGR-${year}-${sequence}`;
};

/**
 * Generate a PDF Buffer for an agreement.
 *
 * @param {object} agreementData - Populated agreement document
 * @param {object} tenantData    - Tenant document
 * @param {object} pgData        - PG document
 * @returns {Promise<Buffer>}
 */
const generateAgreementPDFBuffer = (agreementData, tenantData, pgData) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });

    // ─── PDF Content ─────────────────────────────────────────────
    const ownerName = pgData?.owner?.name || 'PG Owner';
    const tenantName = tenantData?.name || 'Tenant';
    const pgName = pgData?.name || 'PG';
    const pgAddress = pgData?.address || '';
    const startDate = agreementData.startDate ? new Date(agreementData.startDate).toLocaleDateString('en-IN') : 'N/A';
    const endDate   = agreementData.endDate ? new Date(agreementData.endDate).toLocaleDateString('en-IN') : 'N/A';

    // Header
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .fillColor('#1e1b4b')
      .text('RENTAL AGREEMENT', { align: 'center' })
      .moveDown(0.3)
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#4338ca')
      .text(`Agreement No: ${agreementData.agreementNumber}`, { align: 'center' })
      .moveDown(1);

    // Divider
    doc.strokeColor('#e0e7ff').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(0.8);

    // Parties
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#111827')
      .text('PARTIES TO THE AGREEMENT')
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#374151')
      .text(`Landlord/Owner: ${ownerName}`)
      .text(`Property: ${pgName}`)
      .text(`Address: ${pgAddress}`)
      .moveDown(0.5)
      .text(`Tenant: ${tenantName}`)
      .text(`Phone: ${tenantData?.phone || 'N/A'}`)
      .text(`Email: ${tenantData?.email || 'N/A'}`)
      .moveDown(1);

    doc.strokeColor('#e0e7ff').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(0.8);

    // Tenancy Details
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#111827')
      .text('TENANCY DETAILS')
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#374151')
      .text(`Start Date:        ${startDate}`)
      .text(`End Date:          ${endDate}`)
      .text(`Monthly Rent:      ₹${agreementData.monthlyRent?.toLocaleString('en-IN') || 0}`)
      .text(`Security Deposit:  ₹${agreementData.securityDeposit?.toLocaleString('en-IN') || 0}`)
      .text(`Notice Period:     ${agreementData.noticePeriodDays || 30} days`)
      .text(`Rent Due Day:      ${agreementData.rentDueDay || 1} of each month`)
      .moveDown(1);

    doc.strokeColor('#e0e7ff').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(0.8);

    // Terms
    if (agreementData.terms) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#111827')
        .text('TERMS & CONDITIONS')
        .moveDown(0.5)
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#374151')
        .text(agreementData.terms, { lineGap: 4 })
        .moveDown(1);
    }

    // Rules
    const rules = agreementData.rules || {};
    if (rules.guestPolicy || rules.foodPolicy || rules.smokingAllowed !== undefined || rules.petsAllowed !== undefined) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#111827')
        .text('HOUSE RULES')
        .moveDown(0.5)
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#374151');

      if (rules.guestPolicy) doc.text(`Guest Policy: ${rules.guestPolicy}`);
      if (rules.foodPolicy)  doc.text(`Food Policy:  ${rules.foodPolicy}`);
      doc.text(`Smoking: ${rules.smokingAllowed ? 'Allowed' : 'Not Allowed'}`);
      doc.text(`Pets:    ${rules.petsAllowed ? 'Allowed' : 'Not Allowed'}`);
      if (rules.other)      doc.text(`Other:   ${rules.other}`);
      doc.moveDown(1);
    }

    doc.strokeColor('#e0e7ff').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(1.5);

    // Signatures
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#111827')
      .text('SIGNATURES')
      .moveDown(0.8);

    const sigY = doc.y;
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#374151')
      .text('Landlord / Owner', 50,  sigY)
      .text('Tenant',           350, sigY)
      .moveDown(3);

    const lineY = doc.y;
    doc
      .strokeColor('#9ca3af')
      .lineWidth(1)
      .moveTo(50,  lineY).lineTo(250, lineY).stroke()
      .moveTo(350, lineY).lineTo(545, lineY).stroke()
      .moveDown(0.5)
      .text(ownerName, 50,  doc.y)
      .text(tenantName, 350, doc.y - doc.currentLineHeight());

    // Footer
    doc
      .fontSize(9)
      .fillColor('#9ca3af')
      .text(
        `Generated by PGInfo.online on ${new Date().toLocaleString('en-IN')}`,
        50, doc.page.height - 60,
        { align: 'center', width: doc.page.width - 100 }
      );

    doc.end();
  });
};

/**
 * Generate a PDF for an agreement and upload it to Cloudinary.
 */
const generateAgreementPDF = async (agreementData, tenantData, pgData) => {
  const pdfBuffer = await generateAgreementPDFBuffer(agreementData, tenantData, pgData);

  try {
    const uploadResult = await new Promise((res, rej) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder:        'pginfo/agreements',
          resource_type: 'auto',
          public_id:     `agreement_${agreementData.agreementNumber}.pdf`,
          overwrite:     true,
        },
        (error, result) => {
          if (error) rej(error);
          else res(result);
        }
      );
      const readable = new streamifier.PassThrough();
      readable.end(pdfBuffer);
      readable.pipe(uploadStream);
    });

    return { url: uploadResult.secure_url, publicId: uploadResult.public_id };
  } catch (uploadErr) {
    console.error('Cloudinary PDF upload warning:', uploadErr.message);
    return { url: null, publicId: null };
  }
};

module.exports = { generateAgreementNumber, generateAgreementPDFBuffer, generateAgreementPDF };

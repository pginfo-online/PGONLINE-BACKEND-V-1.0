const ExcelJS = require('exceljs');
const PG = require('../models/PG.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const RentRecord = require('../models/RentRecord.model');
const Tenant = require('../models/Tenant.model');

// ─── Filter Parsing ────────────────────────────────────────────────────────────

const parseExportFilters = (params = {}) => {
  const query = {};
  const dataset = params.dataset || 'pgs';

  if (dataset === 'pgs') {
    const cleanStatus = typeof params.status === 'string' ? params.status.trim() : '';
    if (cleanStatus && cleanStatus !== 'all') query.status = cleanStatus;

    const cleanCity = typeof params.city === 'string' ? params.city.trim() : '';
    if (cleanCity) query.city = new RegExp(cleanCity, 'i');

    const cleanArea = typeof params.area === 'string' ? params.area.trim() : '';
    if (cleanArea) query.area = new RegExp(cleanArea, 'i');

    if (params.isVerified === 'true' || params.isVerified === true) query.isVerified = true;
    else if (params.isVerified === 'false' || params.isVerified === false) query.isVerified = false;

    if (params.gender && params.gender !== 'any') query.gender = params.gender;
  } else if (dataset === 'users') {
    if (params.role && params.role !== 'all') query.role = params.role;
    if (params.isSuspended !== undefined && params.isSuspended !== '') {
      query.isSuspended = params.isSuspended === 'true' || params.isSuspended === true;
    }
  } else if (dataset === 'leads') {
    if (params.type && params.type !== 'all') query.type = params.type;
    if (params.isRead !== undefined && params.isRead !== '') {
      query.isRead = params.isRead === 'true' || params.isRead === true;
    }
  } else if (dataset === 'rent') {
    if (params.status && params.status !== 'all') query.status = params.status;
    if (params.billingYear) query.billingYear = parseInt(params.billingYear, 10);
    if (params.billingMonth) query.billingMonth = parseInt(params.billingMonth, 10);
  }

  // Common date range filter
  if (params.startDate || params.endDate) {
    query.createdAt = {};
    if (params.startDate) query.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) {
      const end = new Date(params.endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  return query;
};

// ─── Header Styling ────────────────────────────────────────────────────────────

const styleHeaderRow = (headerRow, sheetName = '') => {
  headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E1B4B' }, // Deep indigo / navy
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  headerRow.height = 30;
};

// ─── Column Schemas ───────────────────────────────────────────────────────────

const PG_COLUMNS = [
  { header: 'PG ID', key: 'id', width: 26 },
  { header: 'PG Name', key: 'name', width: 30 },
  { header: 'Owner Name', key: 'ownerName', width: 20 },
  { header: 'Owner Email', key: 'ownerEmail', width: 25 },
  { header: 'Owner Phone', key: 'ownerPhone', width: 15 },
  { header: 'Property Type', key: 'propertyType', width: 15 },
  { header: 'Gender Allowed', key: 'gender', width: 15 },
  { header: 'City', key: 'city', width: 15 },
  { header: 'Area', key: 'area', width: 18 },
  { header: 'Full Address', key: 'address', width: 35 },
  { header: 'Google Maps Link', key: 'mapsLink', width: 35 },
  { header: 'Landmark', key: 'landmark', width: 20 },
  { header: 'Rent (Single)', key: 'rentSingle', width: 15 },
  { header: 'Rent (Double)', key: 'rentDouble', width: 15 },
  { header: 'Rent (Triple)', key: 'rentTriple', width: 15 },
  { header: 'Security Deposit', key: 'securityDeposit', width: 15 },
  { header: 'Food Option', key: 'food', width: 15 },
  { header: 'AC Available', key: 'ac', width: 15 },
  { header: 'Total Beds', key: 'totalBeds', width: 12 },
  { header: 'Available Beds', key: 'availableBeds', width: 15 },
  { header: 'Facilities', key: 'facilities', width: 35 },
  { header: 'Verified', key: 'isVerified', width: 12 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Views', key: 'views', width: 10 },
  { header: 'Inquiries', key: 'inquiries', width: 10 },
  { header: 'Contact Phone', key: 'contactPhone', width: 15 },
  { header: 'Created At', key: 'createdAt', width: 22 },
  { header: 'Room Configs Details', key: 'roomConfigs', width: 45 },
];

const USER_COLUMNS = [
  { header: 'User ID', key: 'id', width: 26 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Role', key: 'role', width: 14 },
  { header: 'City', key: 'city', width: 16 },
  { header: 'Suspended', key: 'isSuspended', width: 12 },
  { header: 'Email Verified', key: 'isEmailVerified', width: 14 },
  { header: 'Phone Verified', key: 'isPhoneVerified', width: 14 },
  { header: 'Created At', key: 'createdAt', width: 22 },
];

const LEAD_COLUMNS = [
  { header: 'Lead ID', key: 'id', width: 26 },
  { header: 'PG Name', key: 'pgName', width: 28 },
  { header: 'PG City', key: 'pgCity', width: 16 },
  { header: 'PG Area', key: 'pgArea', width: 18 },
  { header: 'Tenant Name', key: 'tenantName', width: 22 },
  { header: 'Tenant Email', key: 'tenantEmail', width: 26 },
  { header: 'Tenant Phone', key: 'tenantPhone', width: 16 },
  { header: 'Type', key: 'type', width: 14 },
  { header: 'Message', key: 'message', width: 40 },
  { header: 'Read', key: 'isRead', width: 10 },
  { header: 'Created At', key: 'createdAt', width: 22 },
];

const RENT_COLUMNS = [
  { header: 'Record ID', key: 'id', width: 26 },
  { header: 'Tenant Name', key: 'tenantName', width: 22 },
  { header: 'Tenant Phone', key: 'tenantPhone', width: 16 },
  { header: 'PG Name', key: 'pgName', width: 26 },
  { header: 'Billing Month', key: 'billingMonth', width: 14 },
  { header: 'Billing Year', key: 'billingYear', width: 14 },
  { header: 'Total Rent (₹)', key: 'totalAmount', width: 16 },
  { header: 'Paid Amount (₹)', key: 'paidAmount', width: 16 },
  { header: 'Pending Amount (₹)', key: 'pendingAmount', width: 18 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Due Date', key: 'dueDate', width: 18 },
  { header: 'Payment Mode', key: 'paymentMode', width: 15 },
  { header: 'Created At', key: 'createdAt', width: 22 },
];

// ─── Format Row Handlers ──────────────────────────────────────────────────────

const formatPGRow = (doc) => ({
  id: doc._id ? doc._id.toString() : '',
  name: doc.name || '',
  ownerName: doc.owner ? doc.owner.name : 'N/A',
  ownerEmail: doc.owner ? doc.owner.email : 'N/A',
  ownerPhone: doc.owner ? doc.owner.phone : 'N/A',
  propertyType: doc.propertyType || '',
  gender: doc.gender || '',
  city: doc.city || '',
  area: doc.area || '',
  address: doc.address || '',
  mapsLink: doc.mapsLink || '',
  landmark: doc.landmark || '',
  rentSingle: doc.rent?.single ?? '',
  rentDouble: doc.rent?.double ?? '',
  rentTriple: doc.rent?.triple ?? '',
  securityDeposit: doc.securityDeposit ?? '',
  food: doc.food || '',
  ac: doc.ac ? 'Yes' : 'No',
  totalBeds: doc.totalBeds ?? '',
  availableBeds: doc.availableBeds ?? '',
  facilities: Array.isArray(doc.facilities) ? doc.facilities.join(', ') : '',
  isVerified: doc.isVerified ? 'Yes' : 'No',
  status: doc.status || '',
  views: doc.views || 0,
  inquiries: doc.inquiries || 0,
  contactPhone: doc.contactPhone || '',
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '',
  roomConfigs: Array.isArray(doc.roomConfigs)
    ? doc.roomConfigs.map(r => `${r.shareType || ''}: ₹${r.rent || 0} (${r.availableBeds || 0}/${r.totalBeds || 0} beds)`).join(' | ')
    : '',
});

const formatUserRow = (doc) => ({
  id: doc._id ? doc._id.toString() : '',
  name: doc.name || '',
  email: doc.email || '',
  phone: doc.phone || '',
  role: doc.role || '',
  city: doc.city || '',
  isSuspended: doc.isSuspended ? 'Yes' : 'No',
  isEmailVerified: doc.isEmailVerified ? 'Yes' : 'No',
  isPhoneVerified: doc.isPhoneVerified ? 'Yes' : 'No',
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '',
});

const formatLeadRow = (doc) => ({
  id: doc._id ? doc._id.toString() : '',
  pgName: doc.pg?.name || 'N/A',
  pgCity: doc.pg?.city || '',
  pgArea: doc.pg?.area || '',
  tenantName: doc.tenant?.name || 'N/A',
  tenantEmail: doc.tenant?.email || 'N/A',
  tenantPhone: doc.tenant?.phone || 'N/A',
  type: doc.type || 'inquiry',
  message: doc.message || '',
  isRead: doc.isRead ? 'Yes' : 'No',
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '',
});

const formatRentRow = (doc) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mStr = doc.billingMonth ? months[doc.billingMonth - 1] : '';
  const pending = Math.max(0, (doc.totalAmount || 0) - (doc.paidAmount || 0));

  return {
    id: doc._id ? doc._id.toString() : '',
    tenantName: doc.tenant?.name || 'N/A',
    tenantPhone: doc.tenant?.phone || 'N/A',
    pgName: doc.pg?.name || 'N/A',
    billingMonth: mStr,
    billingYear: doc.billingYear || '',
    totalAmount: doc.totalAmount || 0,
    paidAmount: doc.paidAmount || 0,
    pendingAmount: pending,
    status: doc.status || 'pending',
    dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : '',
    paymentMode: doc.paymentMode || '',
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '',
  };
};

// ─── Stream Generator ─────────────────────────────────────────────────────────

const generateExcelStream = async ({ dataset = 'pgs', query = {}, writeStream, onProgress }) => {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: writeStream,
    useStyles: true,
    useSharedStrings: true,
  });

  let sheetName = 'PG Listings';
  let columns = PG_COLUMNS;
  let cursor;
  let totalCount = 0;
  let rowFormatter = formatPGRow;

  if (dataset === 'users') {
    sheetName = 'Users & Owners';
    columns = USER_COLUMNS;
    totalCount = await User.countDocuments(query);
    cursor = User.find(query).sort({ createdAt: -1 }).lean().cursor();
    rowFormatter = formatUserRow;
  } else if (dataset === 'leads') {
    sheetName = 'Leads & Inquiries';
    columns = LEAD_COLUMNS;
    totalCount = await Lead.countDocuments(query);
    cursor = Lead.find(query)
      .populate('pg', 'name city area')
      .populate('tenant', 'name email phone')
      .sort({ createdAt: -1 })
      .lean()
      .cursor();
    rowFormatter = formatLeadRow;
  } else if (dataset === 'rent') {
    sheetName = 'Rent Records';
    columns = RENT_COLUMNS;
    totalCount = await RentRecord.countDocuments(query);
    cursor = RentRecord.find(query)
      .populate('tenant', 'name phone')
      .populate('pg', 'name')
      .sort({ createdAt: -1 })
      .lean()
      .cursor();
    rowFormatter = formatRentRow;
  } else {
    // Default PGs
    sheetName = 'PG Listings';
    columns = PG_COLUMNS;
    totalCount = await PG.countDocuments(query);
    cursor = PG.find(query)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .lean()
      .cursor();
    rowFormatter = formatPGRow;
  }

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  styleHeaderRow(headerRow, sheetName);
  headerRow.commit();

  let processedCount = 0;

  // Pre-calculate column index formatting map
  const columnFormattingMap = {};
  columns.forEach((col, idx) => {
    const colNumber = idx + 1;
    if (['rentSingle', 'rentDouble', 'rentTriple', 'securityDeposit', 'totalAmount', 'paidAmount', 'pendingAmount'].includes(col.key)) {
      columnFormattingMap[colNumber] = { numFmt: '₹#,##0', alignment: { horizontal: 'right' } };
    } else if (['totalBeds', 'availableBeds', 'views', 'inquiries'].includes(col.key)) {
      columnFormattingMap[colNumber] = { numFmt: '#,##0', alignment: { horizontal: 'right' } };
    }
  });

  for await (const doc of cursor) {
    const formattedData = rowFormatter(doc);
    const row = sheet.addRow(formattedData);

    // Apply numerical and currency formatting via 1-based integer index
    Object.entries(columnFormattingMap).forEach(([colNumStr, format]) => {
      const cell = row.getCell(parseInt(colNumStr, 10));
      if (cell && cell.value !== '' && cell.value !== undefined && cell.value !== null) {
        cell.numFmt = format.numFmt;
        cell.alignment = format.alignment;
      }
    });

    row.commit();
    processedCount++;

    if (onProgress && processedCount % 50 === 0) {
      await onProgress(processedCount, totalCount);
    }
  }

  if (onProgress) {
    await onProgress(processedCount, totalCount);
  }

  await workbook.commit();
};

// Legacy compatibility wrapper
const generatePGExcelStream = async (writeStream, query, onProgress) => {
  return generateExcelStream({ dataset: 'pgs', query, writeStream, onProgress });
};

module.exports = {
  parseExportFilters,
  styleHeaderRow,
  generateExcelStream,
  generatePGExcelStream,
};

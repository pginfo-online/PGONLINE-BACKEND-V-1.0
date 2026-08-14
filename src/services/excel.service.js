const ExcelJS = require('exceljs');
const PG = require('../models/PG.model');

/**
 * Translates query parameters into a Mongoose query filter object.
 * Supports status, city, area, isVerified, and a search query.
 * @param {Object} params - The HTTP query/body request parameters
 * @returns {Object} Mongoose query object
 */
const parseExportFilters = (params) => {
  const query = {};

  const cleanStatus = typeof params.status === 'string' ? params.status.trim() : '';
  if (cleanStatus && cleanStatus !== 'all') {
    query.status = cleanStatus;
  }

  const cleanCity = typeof params.city === 'string' ? params.city.trim() : '';
  if (cleanCity) {
    query.city = new RegExp(cleanCity, 'i');
  }

  const cleanArea = typeof params.area === 'string' ? params.area.trim() : '';
  if (cleanArea) {
    query.area = new RegExp(cleanArea, 'i');
  }

  if (params.isVerified === 'true' || params.isVerified === true) {
    query.isVerified = true;
  } else if (params.isVerified === 'false' || params.isVerified === false) {
    query.isVerified = false;
  }

  const cleanSearch = typeof params.search === 'string' ? params.search.trim().replace(/\s+/g, ' ') : '';
  if (cleanSearch) {
    const searchTerms = cleanSearch.split(' ').filter(Boolean);
    const escapedTerms = searchTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    query.$or = escapedTerms.flatMap((term) => [
      { name: new RegExp(term, 'i') },
      { area: new RegExp(term, 'i') },
      { city: new RegExp(term, 'i') },
      { address: new RegExp(term, 'i') },
      { description: new RegExp(term, 'i') },
      { contactPhone: new RegExp(term, 'i') },
    ]);
  }

  return query;
};

/**
 * Returns column schema definition for ExcelJS sheet
 * @returns {Array<Object>} Columns configuration
 */
const getExcelColumns = () => [
  { header: 'PG ID', key: 'id', width: 26 },
  { header: 'PG Name', key: 'name', width: 30 },
  { header: 'Owner Name', key: 'ownerName', width: 20 },
  { header: 'Owner Email', key: 'ownerEmail', width: 25 },
  { header: 'Owner Phone', key: 'ownerPhone', width: 15 },
  { header: 'Property Type', key: 'propertyType', width: 15 },
  { header: 'Gender Allowed', key: 'gender', width: 15 },
  { header: 'City', key: 'city', width: 15 },
  { header: 'Area', key: 'area', width: 15 },
  { header: 'Full Address', key: 'address', width: 40 },
  { header: 'Google Maps Link', key: 'mapsLink', width: 40 },
  { header: 'Landmark', key: 'landmark', width: 20 },
  { header: 'Postal Code', key: 'postalCode', width: 12 },
  { header: 'Latitude', key: 'latitude', width: 12 },
  { header: 'Longitude', key: 'longitude', width: 12 },
  { header: 'Rent (Single)', key: 'rentSingle', width: 15 },
  { header: 'Rent (Double)', key: 'rentDouble', width: 15 },
  { header: 'Rent (Triple)', key: 'rentTriple', width: 15 },
  { header: 'Security Deposit', key: 'securityDeposit', width: 15 },
  { header: 'Notice Period (Days)', key: 'noticePeriod', width: 20 },
  { header: 'Min Stay (Days)', key: 'minStay', width: 15 },
  { header: 'Max Stay (Days)', key: 'maxStay', width: 15 },
  { header: 'Food Option', key: 'food', width: 15 },
  { header: 'Food Included', key: 'foodIncluded', width: 15 },
  { header: 'AC Available', key: 'ac', width: 15 },
  { header: 'Total Floors', key: 'floors', width: 12 },
  { header: 'Total Rooms', key: 'totalRooms', width: 12 },
  { header: 'Total Beds', key: 'totalBeds', width: 12 },
  { header: 'Available Beds', key: 'availableBeds', width: 15 },
  { header: 'Available Rooms', key: 'availableRooms', width: 15 },
  { header: 'Facilities', key: 'facilities', width: 40 },
  { header: 'Verified', key: 'isVerified', width: 12 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Rejection Reason', key: 'rejectionReason', width: 30 },
  { header: 'Views', key: 'views', width: 10 },
  { header: 'Inquiries', key: 'inquiries', width: 10 },
  { header: 'Contact Phone', key: 'contactPhone', width: 15 },
  { header: 'Contact WhatsApp', key: 'contactWhatsapp', width: 18 },
  { header: 'Created At', key: 'createdAt', width: 22 },
  { header: 'Updated At', key: 'updatedAt', width: 22 },
  { header: 'Room Configurations Details', key: 'roomConfigs', width: 50 },
  { header: 'Nearby Places Details', key: 'nearbyPlaces', width: 50 },
  { header: 'Photos URLs', key: 'photos', width: 50 },
  { header: 'Videos URLs', key: 'videos', width: 50 },
];

/**
 * Applies visual styling to the Excel header row
 * @param {Object} headerRow - ExcelJS Row instance
 */
const styleHeaderRow = (headerRow) => {
  headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1A365D' }, // Sleek navy blue background
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  headerRow.height = 28;
};

/**
 * Formats a populated PG mongoose/lean document into a flat data row for ExcelJS.
 * Handles fallbacks, type formatting, and nested arrays cleanly.
 * @param {Object} doc - Raw PG document (lean)
 * @returns {Object} Key-value row data matching the columns schema
 */
const formatPGRow = (doc) => {
  const coordinates = doc.location && doc.location.coordinates ? doc.location.coordinates : null;
  const lng = coordinates && typeof coordinates[0] === 'number' ? coordinates[0] : '';
  const lat = coordinates && typeof coordinates[1] === 'number' ? coordinates[1] : '';

  return {
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
    postalCode: doc.postalCode || '',
    latitude: doc.latitude != null ? doc.latitude : lat,
    longitude: doc.longitude != null ? doc.longitude : lng,
    rentSingle: doc.rent && doc.rent.single != null ? doc.rent.single : '',
    rentDouble: doc.rent && doc.rent.double != null ? doc.rent.double : '',
    rentTriple: doc.rent && doc.rent.triple != null ? doc.rent.triple : '',
    securityDeposit: doc.securityDeposit != null ? doc.securityDeposit : '',
    noticePeriod: doc.noticePeriod != null ? doc.noticePeriod : '',
    minStay: doc.minStay != null ? doc.minStay : '',
    maxStay: doc.maxStay != null ? doc.maxStay : '',
    food: doc.food || '',
    foodIncluded: doc.foodIncluded ? 'Yes' : 'No',
    ac: doc.ac ? 'Yes' : 'No',
    floors: doc.floors || '',
    totalRooms: doc.totalRooms || '',
    totalBeds: doc.totalBeds || '',
    availableBeds: doc.availableBeds || '',
    availableRooms: doc.availableRooms || '',
    facilities: Array.isArray(doc.facilities) ? doc.facilities.join(', ') : '',
    isVerified: doc.isVerified ? 'Yes' : 'No',
    status: doc.status || '',
    rejectionReason: doc.rejectionReason || '',
    views: doc.views || 0,
    inquiries: doc.inquiries || 0,
    contactPhone: doc.contactPhone || '',
    contactWhatsapp: doc.contactWhatsapp || '',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : (doc.createdAt ? new Date(doc.createdAt).toISOString() : ''),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt ? new Date(doc.updatedAt).toISOString() : ''),
    roomConfigs: Array.isArray(doc.roomConfigs)
      ? doc.roomConfigs.map(rc => `${rc.shareType || ''}: ₹${rc.rent || 0} (Beds: ${rc.totalBeds || 0}, Avail: ${rc.availableBeds || 0})`).join(' | ')
      : '',
    nearbyPlaces: Array.isArray(doc.nearbyPlaces)
      ? doc.nearbyPlaces.map(np => `${np.placeType || ''}: ${np.name || ''} (${np.distance || 0} km)`).join(' | ')
      : '',
    photos: Array.isArray(doc.photos) ? doc.photos.map(p => p.url).join(', ') : '',
    videos: Array.isArray(doc.videos) ? doc.videos.map(v => v.url).join(', ') : '',
  };
};

/**
 * Numeric columns that require right alignment and formatted number values in ExcelJS
 */
const NUMERIC_COLUMNS = [
  'rentSingle',
  'rentDouble',
  'rentTriple',
  'securityDeposit',
  'noticePeriod',
  'minStay',
  'maxStay',
  'floors',
  'totalRooms',
  'totalBeds',
  'availableBeds',
  'availableRooms',
  'views',
  'inquiries',
  'latitude',
  'longitude',
];

/**
 * Streams PG data to a write stream using WorkbookWriter (flat memory signature).
 * @param {stream.Writable} writeStream - Writable target stream (e.g. res or fs.createWriteStream)
 * @param {Object} query - Mongoose database filter query
 * @param {Function} [onProgress] - Optional progress callback function(processedCount)
 * @returns {Promise<void>} Resolves when excel stream writing completes
 */
const generatePGExcelStream = async (writeStream, query, onProgress) => {
  // Use useStyles: true to allow cell styling during stream commits
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: writeStream,
    useStyles: true,
    useSharedStrings: true,
  });

  const sheet = workbook.addWorksheet('PG Listings');

  // Define columns schema
  sheet.columns = getExcelColumns();

  // Style header row and commit
  const headerRow = sheet.getRow(1);
  styleHeaderRow(headerRow);
  headerRow.commit();

  // Retrieve MongoDB cursor - populated with owner details, using .lean() for minimal overhead
  const cursor = PG.find(query)
    .populate('owner', 'name email phone')
    .sort({ createdAt: -1 })
    .lean()
    .cursor();

  let processedCount = 0;

  for await (const doc of cursor) {
    const formattedData = formatPGRow(doc);
    const row = sheet.addRow(formattedData);

    // Apply specific number styling to numerical cells
    NUMERIC_COLUMNS.forEach((colKey) => {
      const cell = row.getCell(colKey);
      if (cell.value !== '' && cell.value !== undefined && cell.value !== null) {
        if (colKey === 'latitude' || colKey === 'longitude') {
          cell.numFmt = '0.000000'; // Coordinates formatting
        } else {
          cell.numFmt = '#,##0'; // Currency/Integer formatting
        }
        cell.alignment = { horizontal: 'right' };
      }
    });

    row.commit();
    processedCount++;

    if (onProgress && processedCount % 50 === 0) {
      await onProgress(processedCount);
    }
  }

  // Final push of progress call to report final count
  if (onProgress) {
    await onProgress(processedCount);
  }

  // Committing the workbook finalizes the zip file structure and flushes to stream
  await workbook.commit();
};

module.exports = {
  parseExportFilters,
  getExcelColumns,
  styleHeaderRow,
  formatPGRow,
  generatePGExcelStream,
};

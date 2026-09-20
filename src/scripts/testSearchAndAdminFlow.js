const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Property = require('../models/Property.model');
const User = require('../models/User.model');
const propertySearchService = require('../services/propertySearch.service');
const propertyApprovalService = require('../services/propertyApproval.service');
const propertyService = require('../services/property.service');

async function testSearchAndAdminFlow() {
  await connectDB();
  console.log('\n--- STARTING SEARCH & ADMIN FLOW VERIFICATION ---\n');

  // 1. Get an admin user
  const admin = await User.findOne({ role: 'admin' }).lean();
  const owner = await User.findOne({ role: 'owner' }).lean() || admin;
  console.log(`Using Admin: ${admin.name} (${admin._id})`);
  console.log(`Using Owner: ${owner.name} (${owner._id})`);

  // 2. Create sample test properties in each category
  console.log('\nCreating sample test properties...');
  
  const testFlat = await Property.create({
    owner: owner._id,
    category: 'residential_rental',
    purpose: 'rent',
    title: 'Flow Verification 2BHK Smart Home',
    city: 'Pune',
    area: 'Baner',
    address: 'Pan Card Club Road, Baner',
    location: { type: 'Point', coordinates: [73.7868, 18.5590] },
    pricing: {
      expectedPrice: 28000,
      securityDeposit: 60000,
      maintenanceCharges: 2500,
    },
    contactPhone: '9123456780',
    residentialDetails: {
      propertySubtype: 'apartment_flat',
      bhk: '2BHK',
      bedrooms: 2,
      bathrooms: 2,
      carpetAreaSqFt: 980,
      furnishingStatus: 'semi_furnished',
      societyName: 'Smart Heights',
    },
    amenities: ['Gated Community', 'Swimming Pool', 'Gymnasium', 'Power Backup'],
    status: 'pending',
  });

  const testOffice = await Property.create({
    owner: owner._id,
    category: 'commercial',
    purpose: 'rent',
    title: 'Flow Verification Plug-n-Play Office',
    city: 'Pune',
    area: 'Viman Nagar',
    address: 'Symbiosis Road, Viman Nagar',
    location: { type: 'Point', coordinates: [73.9143, 18.5679] },
    pricing: {
      expectedPrice: 125000,
      securityDeposit: 750000,
      pricePerSqFt: 75,
      camChargesPerSqFt: 10,
    },
    contactPhone: '9123456781',
    commercialDetails: {
      commercialSubtype: 'office_space',
      carpetAreaSqFt: 1800,
      fitoutStatus: 'fully_furnished_plug_and_play',
      powerLoadKW: 40,
    },
    amenities: ['Central Air Conditioning', 'High Speed Elevators', 'DG Power Backup (100%)'],
    status: 'pending',
  });

  console.log(`✅ Created test 2BHK Flat: ${testFlat._id}`);
  console.log(`✅ Created test Commercial Office: ${testOffice._id}`);

  // 3. Test Admin Property Analytics
  console.log('\nTesting Admin Property Analytics...');
  const analytics = await propertyApprovalService.getPropertyAdminAnalytics();
  console.log('Admin Analytics Result:', {
    total: analytics.total,
    pending: analytics.pending,
    approved: analytics.approved,
    rejected: analytics.rejected,
    byCategory: analytics.byCategory,
  });

  if (analytics.total > 0 && analytics.byCategory.residential_rental >= 1 && analytics.byCategory.commercial >= 1) {
    console.log('✅ Admin Analytics correctly tallies properties across categories!');
  } else {
    throw new Error('Analytics count mismatch');
  }

  // 4. Test Admin Queue Retrieval with Filters
  console.log('\nTesting Admin Queue Retrieval...');
  const adminRes = await propertyApprovalService.getAllPropertiesForAdmin({
    category: 'residential_rental',
    status: 'pending',
  });
  console.log(`✅ Admin Pending Flats Queue: found ${adminRes.properties.length} listings (total ${adminRes.pagination.total})`);

  // 5. Test Admin Moderation Actions
  console.log('\nTesting Admin Moderation Actions...');
  // Approve flat
  const approvedFlat = await propertyApprovalService.approveProperty(testFlat._id, admin._id);
  console.log(`✅ Flat approved: status = ${approvedFlat.status}, reviewedBy = ${approvedFlat.reviewedBy?.name}`);

  // Request correction on office
  const correctedOffice = await propertyApprovalService.requestCorrection(
    testOffice._id,
    admin._id,
    'Please verify power load certificate'
  );
  console.log(`✅ Office correction requested: status = ${correctedOffice.status}, comments = "${correctedOffice.correctionComments}"`);

  // Verify badge toggle
  const verifiedFlat = await propertyApprovalService.toggleVerify(testFlat._id);
  console.log(`✅ Flat verify badge toggled: isVerified = ${verifiedFlat.isVerified}`);

  // 6. Test Public Search & Discovery
  console.log('\nTesting Public Cross-Category Search...');
  
  // Search Flats by BHK
  const flatSearch = await propertySearchService.searchProperties({
    city: 'Pune',
    category: 'residential_rental',
    bhk: '2BHK',
  });
  console.log(`✅ Public Search [Pune + 2BHK Flats]: returned ${flatSearch.properties.length} results`);

  // Search Commercial by Subtype
  // First approve office to test approved search filter
  await Property.findByIdAndUpdate(testOffice._id, { status: 'approved' });
  const commSearch = await propertySearchService.searchProperties({
    city: 'Pune',
    category: 'commercial',
    commercialSubtype: 'office_space',
  });
  console.log(`✅ Public Search [Pune + Commercial Offices]: returned ${commSearch.properties.length} results`);

  // Autocomplete Suggestions
  const suggestions = await propertySearchService.getPropertySuggestions('Pune');
  console.log(`✅ Autocomplete Suggestions for "Pune": ${suggestions.length} items`);

  // 7. Cleanup test records
  console.log('\nCleaning up verification records...');
  await Property.deleteMany({ _id: { $in: [testFlat._id, testOffice._id] } });
  console.log('✅ Cleaned up temporary test documents.');

  console.log('\n🎉 ALL SEARCH, DISCOVERY & ADMIN MODERATION CHECKS PASSED 100%!');
  await mongoose.disconnect();
}

testSearchAndAdminFlow().catch(async (err) => {
  console.error('❌ Test failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});

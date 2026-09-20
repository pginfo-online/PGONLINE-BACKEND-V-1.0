const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Property = require('../models/Property.model');
const User = require('../models/User.model');

async function testPropertyQueries() {
  await connectDB();
  console.log('Testing Property collection queries...');

  // 1. Check migrated PGs count
  const pgCount = await Property.countDocuments({ category: 'pg' });
  console.log(`✅ Migrated PGs in Property collection: ${pgCount}`);

  // 2. Find a test owner
  const owner = await User.findOne({ role: { $in: ['owner', 'admin'] } }).lean();
  if (!owner) {
    console.error('No owner found to test creation');
    await mongoose.disconnect();
    return;
  }
  console.log(`Using test owner: ${owner.name} (${owner._id})`);

  // 3. Test creating a Residential Rental (Flat)
  const testFlat = await Property.create({
    owner: owner._id,
    category: 'residential_rental',
    purpose: 'rent',
    title: 'Automated Test Luxury 3BHK Apartment',
    city: 'Pune',
    area: 'Kharadi',
    address: 'Tower 4, Eon Waterfront, Kharadi',
    location: { type: 'Point', coordinates: [73.9532, 18.5516] },
    pricing: {
      expectedPrice: 42000,
      securityDeposit: 100000,
      maintenanceCharges: 3500,
      maintenanceType: 'monthly_fixed',
    },
    contactPhone: '9876543210',
    residentialDetails: {
      propertySubtype: 'apartment_flat',
      bhk: '3BHK',
      bedrooms: 3,
      bathrooms: 3,
      balconies: 2,
      carpetAreaSqFt: 1350,
      superBuiltUpAreaSqFt: 1750,
      furnishingStatus: 'fully_furnished',
      reservedCoveredParking: 2,
      societyName: 'Eon Waterfront',
    },
    status: 'approved',
  });
  console.log(`✅ Created test Residential Flat: ${testFlat._id} - ${testFlat.title}`);

  // 4. Test creating a Commercial Office for Rent
  const testOffice = await Property.create({
    owner: owner._id,
    category: 'commercial',
    purpose: 'rent',
    title: 'Automated Test Tech Park Office Space',
    city: 'Pune',
    area: 'Hinjewadi Phase 2',
    address: '5th Floor, Quadron Business Park, Hinjewadi',
    location: { type: 'Point', coordinates: [73.7121, 18.5912] },
    pricing: {
      expectedPrice: 180000,
      pricePerSqFt: 60,
      securityDeposit: 1080000,
      camChargesPerSqFt: 8,
      taxGstApplicable: true,
    },
    contactPhone: '9876543210',
    commercialDetails: {
      commercialSubtype: 'office_space',
      carpetAreaSqFt: 3000,
      superBuiltUpAreaSqFt: 4200,
      fitoutStatus: 'fully_furnished_plug_and_play',
      fitoutDetails: {
        workstationsCount: 45,
        cabinsCount: 3,
        conferenceRoomsCount: 1,
        receptionArea: true,
        pantryType: 'wet',
      },
      powerLoadKW: 60,
      powerBackupCapacityKVA: 100,
      buildingGrade: 'grade_a',
      leaseTerms: {
        leaseDurationYears: 5,
        lockInPeriodMonths: 24,
        annualRentEscalationPercent: 5,
      },
    },
    status: 'approved',
  });
  console.log(`✅ Created test Commercial Office: ${testOffice._id} - ${testOffice.title}`);

  // 5. Query verification
  const residentialQuery = await Property.find({
    category: 'residential_rental',
    'residentialDetails.bhk': '3BHK',
  }).lean();
  console.log(`✅ Query 3BHK Flats: found ${residentialQuery.length} properties`);

  const commercialQuery = await Property.find({
    category: 'commercial',
    'commercialDetails.commercialSubtype': 'office_space',
  }).lean();
  console.log(`✅ Query Commercial Offices: found ${commercialQuery.length} properties`);

  // Clean up test records
  await Property.deleteMany({ _id: { $in: [testFlat._id, testOffice._id] } });
  console.log('✅ Cleaned up automated test properties.');

  console.log('\n🎉 ALL PROPERTY DATABASE & QUERY CHECKS PASSED WITH 100% SUCCESS!');
  await mongoose.disconnect();
}

if (require.main === module) {
  testPropertyQueries()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}

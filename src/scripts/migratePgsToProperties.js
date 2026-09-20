/**
 * Safe, idempotent, non-destructive migration script:
 * Copies and standardizes existing PG documents into the unified Property collection in batches.
 * Existing PGs in MongoDB are NOT altered or deleted.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const PG = require('../models/PG.model');
const Property = require('../models/Property.model');

async function migratePgsToProperties() {
  await connectDB();
  console.log('Connected to MongoDB for non-destructive PG migration...');

  const pgs = await PG.find({}).lean();
  console.log(`Found ${pgs.length} existing PG documents.`);

  const BATCH_SIZE = 500;
  let processed = 0;

  for (let i = 0; i < pgs.length; i += BATCH_SIZE) {
    const chunk = pgs.slice(i, i + BATCH_SIZE);
    const operations = chunk.map((pg) => {
      let minRent = pg.monthlyPricing || 0;
      if (Array.isArray(pg.roomConfigs) && pg.roomConfigs.length > 0) {
        const rents = pg.roomConfigs.map((rc) => Number(rc.rent)).filter((r) => !isNaN(r) && r > 0);
        if (rents.length > 0) minRent = Math.min(...rents);
      }

      const propertyDoc = {
        _id: pg._id,
        owner: pg.owner,
        listedBy: 'owner',
        brokerage: { type: 'zero', amount: 0 },
        category: 'pg',
        purpose: 'rent',
        title: pg.name || 'PG Accommodation',
        description: pg.description || '',
        city: pg.city || 'Pune',
        area: pg.area || '',
        address: pg.address || '',
        fullAddress: pg.fullAddress || '',
        landmark: pg.landmark || '',
        district: pg.district || '',
        state: pg.state || '',
        country: pg.country || 'India',
        postalCode: pg.postalCode || '',
        googlePlaceId: pg.googlePlaceId || '',
        latitude: pg.latitude,
        longitude: pg.longitude,
        mapsLink: pg.mapsLink || '',
        location: pg.location || {
          type: 'Point',
          coordinates: [pg.longitude || 0, pg.latitude || 0],
        },
        pricing: {
          expectedPrice: minRent || 0,
          pricePerSqFt: null,
          securityDeposit: pg.securityDeposit || 0,
          depositMonths: null,
          maintenanceCharges: 0,
          maintenanceType: 'included',
          bookingAmount: 0,
          pricingNegotiable: false,
          camChargesPerSqFt: null,
          dgBackupCharges: null,
          taxGstApplicable: false,
        },
        photos: (pg.photos || []).map((p, idx) => ({
          url: p.url,
          publicId: p.publicId,
          caption: p.caption,
          isMain: p.isMain || idx === 0,
          order: p.order || idx,
          _id: p._id,
        })),
        videos: (pg.videos || []).map((v, idx) => ({
          url: v.url,
          publicId: v.publicId,
          thumbnailUrl: v.thumbnailUrl,
          title: v.title,
          duration: v.duration,
          order: v.order || idx,
          _id: v._id,
        })),
        documents: [],
        amenities: Array.isArray(pg.facilities) ? pg.facilities : [],
        contactPhone: pg.contactPhone || '9999999999',
        contactWhatsapp: pg.contactWhatsapp || '',
        contactEmail: '',
        preferredContactHours: '',
        nearbyPlaces: Array.isArray(pg.nearbyPlaces) ? pg.nearbyPlaces : [],
        status: pg.status || 'approved',
        moderationNotes: null,
        rejectionReason: pg.rejectionReason || null,
        reviewedBy: null,
        reviewedAt: pg.updatedAt,
        isVerified: pg.isVerified || false,
        dataQualityScore: pg.dataQualityScore || 1,
        views: pg.views || 0,
        inquiries: pg.inquiries || 0,
        wishlistCount: 0,
        isFeatured: false,
        pgDetails: {
          propertySubtype: pg.propertyType || 'PG',
          roomConfigs: Array.isArray(pg.roomConfigs) ? pg.roomConfigs : [],
          floors: pg.floors || 1,
          totalRooms: pg.totalRooms || 1,
          propertyAge: pg.propertyAge || 0,
          gender: pg.gender || 'any',
          preferredTenants: Array.isArray(pg.preferredTenants) ? pg.preferredTenants : ['any'],
          food: pg.food || 'none',
          foodIncluded: pg.foodIncluded || false,
          foodInfo: pg.foodInfo || {},
          ac: pg.ac || false,
          rules: pg.rules || {},
          noticePeriod: pg.noticePeriod || 30,
          minStay: pg.minStay || 1,
          maxStay: pg.maxStay || null,
          isAvailable: pg.isAvailable !== false,
          availableRooms: pg.availableRooms || 0,
        },
        residentialDetails: null,
        commercialDetails: null,
        createdAt: pg.createdAt || new Date(),
        updatedAt: pg.updatedAt || new Date(),
      };

      return {
        updateOne: {
          filter: { _id: pg._id },
          update: { $set: propertyDoc },
          upsert: true,
        },
      };
    });

    await Property.bulkWrite(operations, { ordered: false });
    processed += chunk.length;
    console.log(`Processed ${processed} / ${pgs.length} properties...`);
  }

  console.log(`\n🎉 Non-destructive migration complete! Successfully processed ${processed} listings into Property collection.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  migratePgsToProperties()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = migratePgsToProperties;

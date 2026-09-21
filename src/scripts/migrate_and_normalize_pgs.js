/**
 * Safe, Idempotent Database Migration & Normalization Script
 * Normalizes PG rent & roomConfigs, computes expectedPrice, validates photos,
 * and ensures 100% data integrity for Properties and PGs.
 *
 * Usage:
 *   node backend/src/scripts/migrate_and_normalize_pgs.js --dry-run
 *   node backend/src/scripts/migrate_and_normalize_pgs.js --apply
 */

const path = require('path');
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const SHARING_MAP = {
  single: 1,
  double: 2,
  triple: 3,
  four: 4,
  quad: 4,
  five: 5,
  other: 1,
};

function normalizeRentToRoomConfigs(pg) {
  let configs = [];

  // 1. Check existing roomConfigs if present
  if (Array.isArray(pg.roomConfigs) && pg.roomConfigs.length > 0) {
    configs = pg.roomConfigs
      .map((rc) => {
        const rentVal = Number(rc.rent || rc.monthlyRent || 0);
        const depVal = Number(rc.depositAmount || rc.deposit || pg.securityDeposit || rentVal);
        const shareType = (rc.shareType || rc.sharingType || 'single').toLowerCase();
        const sharingNum = Number(rc.sharing) || SHARING_MAP[shareType] || 1;
        if (rentVal <= 0) return null;
        return {
          shareType,
          sharing: sharingNum,
          rent: rentVal,
          monthlyRent: rentVal,
          depositAmount: depVal,
          deposit: depVal,
          totalBeds: Number(rc.totalBeds) || sharingNum,
          availableBeds: Number(rc.availableBeds) || sharingNum,
          bathroomType: rc.bathroomType || 'attached',
          amenities: Array.isArray(rc.amenities) ? rc.amenities : [],
          roomSize: rc.roomSize || '',
        };
      })
      .filter(Boolean);
  }

  // 2. If no valid configs from roomConfigs, synthesize from pg.rent object
  if (configs.length === 0 && pg.rent && typeof pg.rent === 'object') {
    Object.entries(pg.rent).forEach(([tier, val]) => {
      const rentVal = Number(val);
      if (!isNaN(rentVal) && rentVal > 0) {
        const shareType = tier.toLowerCase();
        const sharingNum = SHARING_MAP[shareType] || 1;
        const depVal = Number(pg.securityDeposit) || rentVal;
        configs.push({
          shareType,
          sharing: sharingNum,
          rent: rentVal,
          monthlyRent: rentVal,
          depositAmount: depVal,
          deposit: depVal,
          totalBeds: sharingNum,
          availableBeds: sharingNum,
          bathroomType: 'attached',
          amenities: [],
          roomSize: '',
        });
      }
    });
  }

  // Sort configs by sharing (single, double, triple...)
  configs.sort((a, b) => a.sharing - b.sharing);

  const rents = configs.map((c) => c.rent).filter((r) => r > 0);
  const minRent = rents.length > 0 ? Math.min(...rents) : (Number(pg.minRent) || 0);
  const maxRent = rents.length > 0 ? Math.max(...rents) : (Number(pg.maxRent) || 0);

  return { configs, minRent, maxRent };
}

function sanitizePhotos(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return [];
  const valid = photos
    .map((p, idx) => {
      if (typeof p === 'string') {
        const url = p.trim();
        if (!url || !url.startsWith('http')) return null;
        return {
          url,
          publicId: url.split('/').pop().split('.')[0] || '',
          caption: '',
          isMain: idx === 0,
          order: idx,
        };
      }
      if (p && typeof p === 'object') {
        const url = (p.url || p.secure_url || '').trim();
        if (!url || !url.startsWith('http')) return null;
        return {
          url,
          publicId: p.publicId || p.public_id || '',
          caption: p.caption || '',
          isMain: !!p.isMain,
          order: p.order ?? idx,
          _id: p._id,
        };
      }
      return null;
    })
    .filter(Boolean);

  if (valid.length > 0 && !valid.some((p) => p.isMain)) {
    valid[0].isMain = true;
  }
  return valid;
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');

  if (!isDryRun && !isApply) {
    console.error('Please specify either --dry-run or --apply');
    process.exit(1);
  }

  console.log(`Starting Database Normalization & Migration [Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'}]...`);

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;

  const pgsCollection = db.collection('pgs');
  const propsCollection = db.collection('properties');

  console.log('Loading all existing PGs and Properties into memory...');
  const [allPgs, allProps] = await Promise.all([
    pgsCollection.find({}).toArray(),
    propsCollection.find({}).toArray(),
  ]);

  console.log(`Loaded ${allPgs.length} PGs and ${allProps.length} Properties.`);

  const propMap = new Map();
  allProps.forEach((p) => propMap.set(p._id.toString(), p));

  let pgsUpdatedCount = 0;
  let propsUpdatedCount = 0;
  let propsCreatedCount = 0;

  const pgBulkOps = [];
  const propBulkOps = [];

  for (const pg of allPgs) {
    const { configs, minRent, maxRent } = normalizeRentToRoomConfigs(pg);
    const sanitizedPgPhotos = sanitizePhotos(pg.photos);

    // 1. Prepare PG update if roomConfigs or rent needs normalization
    const pgUpdates = {};
    if (configs.length > 0 && (!Array.isArray(pg.roomConfigs) || pg.roomConfigs.length === 0)) {
      pgUpdates.roomConfigs = configs;
    }
    if (minRent > 0 && (!pg.minRent || pg.minRent === 0)) {
      pgUpdates.minRent = minRent;
    }
    if (maxRent > 0 && (!pg.maxRent || pg.maxRent === 0)) {
      pgUpdates.maxRent = maxRent;
    }

    if (Object.keys(pgUpdates).length > 0) {
      pgsUpdatedCount++;
      pgBulkOps.push({
        updateOne: {
          filter: { _id: pg._id },
          update: { $set: pgUpdates },
        },
      });
    }

    // 2. Check matching Property in `properties` collection
    const prop = propMap.get(pg._id.toString());

    if (prop) {
      const propUpdates = {};

      // Check if roomConfigs is empty in properties
      const existingPropConfigs = prop.pgDetails?.roomConfigs || [];
      if (existingPropConfigs.length === 0 && configs.length > 0) {
        propUpdates['pgDetails.roomConfigs'] = configs;
      }

      // Check if expectedPrice is 0
      if ((!prop.pricing?.expectedPrice || prop.pricing.expectedPrice === 0) && minRent > 0) {
        propUpdates['pricing.expectedPrice'] = minRent;
      }

      // Check photos
      const existingPropPhotos = sanitizePhotos(prop.photos);
      if (existingPropPhotos.length === 0 && sanitizedPgPhotos.length > 0) {
        propUpdates.photos = sanitizedPgPhotos;
      }

      // Check status & isVerified
      if (pg.isVerified && !prop.isVerified) {
        propUpdates.isVerified = true;
      }
      if (pg.status === 'approved' && prop.status !== 'approved') {
        propUpdates.status = 'approved';
      }

      if (Object.keys(propUpdates).length > 0) {
        propsUpdatedCount++;
        propBulkOps.push({
          updateOne: {
            filter: { _id: prop._id },
            update: { $set: propUpdates },
          },
        });
      }
    } else {
      // Property does not exist at all in `properties` collection! Create it.
      propsCreatedCount++;
      const newPropDoc = {
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
          securityDeposit: pg.securityDeposit || minRent || 0,
          depositMonths: null,
          maintenanceCharges: 0,
          maintenanceType: 'included',
          bookingAmount: 0,
          pricingNegotiable: false,
          camChargesPerSqFt: null,
          dgBackupCharges: null,
          taxGstApplicable: false,
        },
        photos: sanitizedPgPhotos,
        videos: (pg.videos || []).map((v, idx) => ({
          url: v.url,
          publicId: v.publicId || '',
          thumbnailUrl: v.thumbnailUrl || '',
          title: v.title || 'Walkthrough Video Tour',
          duration: v.duration || 0,
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
        reviewedAt: pg.updatedAt || new Date(),
        isVerified: pg.isVerified || false,
        dataQualityScore: pg.dataQualityScore || 1,
        views: pg.views || 0,
        inquiries: pg.inquiries || 0,
        wishlistCount: 0,
        isFeatured: false,
        pgDetails: {
          propertySubtype: pg.propertyType || 'PG',
          roomConfigs: configs,
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

      propBulkOps.push({
        insertOne: {
          document: newPropDoc,
        },
      });
    }
  }

  // 3. Check for recently created properties on web that have photos: []
  const emptyPhotoProps = allProps.filter((p) => (!p.photos || p.photos.length === 0) && p.createdAt > new Date('2026-09-01'));
  console.log(`Found ${emptyPhotoProps.length} recent properties in 'properties' collection with empty photos.`);

  console.log(`\n=== Migration Plan Summary ===`);
  console.log(`PGs needing normalization in 'pgs': ${pgsUpdatedCount}`);
  console.log(`Properties needing update in 'properties': ${propsUpdatedCount}`);
  console.log(`Properties needing creation in 'properties': ${propsCreatedCount}`);

  if (isApply) {
    const BATCH_SIZE = 500;

    if (pgBulkOps.length > 0) {
      console.log(`\nApplying ${pgBulkOps.length} updates to 'pgs' collection...`);
      for (let i = 0; i < pgBulkOps.length; i += BATCH_SIZE) {
        const batch = pgBulkOps.slice(i, i + BATCH_SIZE);
        await pgsCollection.bulkWrite(batch, { ordered: false });
        console.log(`  Updated PGs: ${Math.min(i + BATCH_SIZE, pgBulkOps.length)} / ${pgBulkOps.length}`);
      }
    }

    if (propBulkOps.length > 0) {
      console.log(`\nApplying ${propBulkOps.length} updates/creations to 'properties' collection...`);
      for (let i = 0; i < propBulkOps.length; i += BATCH_SIZE) {
        const batch = propBulkOps.slice(i, i + BATCH_SIZE);
        await propsCollection.bulkWrite(batch, { ordered: false });
        console.log(`  Processed Properties: ${Math.min(i + BATCH_SIZE, propBulkOps.length)} / ${propBulkOps.length}`);
      }
    }

    console.log('\nMigration applied successfully!');
  } else {
    console.log('\nDry-run completed. Run with --apply to commit changes to MongoDB Atlas.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

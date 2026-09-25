require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function auditAndFixAreas() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected!');

  const City = require('../models/City.model');
  const Area = require('../models/Area.model');
  const PG = require('../models/PG.model');
  const Property = require('../models/Property.model');

  const allCities = await City.find().select('_id name aliases slug').lean();
  const cityByName = new Map();
  for (const c of allCities) {
    cityByName.set(c.name.toLowerCase().trim(), c);
  }

  const allAreas = await Area.find().populate('city', 'name').lean();
  console.log(`Total area records in DB: ${allAreas.length}`);

  let nullFixed = 0;
  let crossCityFixed = 0;
  let duplicatesCleaned = 0;

  // Step 1: Fix null city references
  for (const a of allAreas) {
    if (!a.city && a.cityName) {
      const match = cityByName.get(a.cityName.toLowerCase().trim());
      if (match) {
        const existing = await Area.findOne({
          city: match._id,
          name: { $regex: new RegExp(`^${(a.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        });
        if (existing) {
          await Promise.all([
            PG.updateMany({ areaId: a._id }, { $set: { areaId: existing._id, city: match.name } }),
            Property.updateMany({ areaId: a._id }, { $set: { areaId: existing._id, city: match.name } }),
          ]);
          await Area.deleteOne({ _id: a._id });
        } else {
          await Area.updateOne({ _id: a._id }, { $set: { city: match._id } });
        }
        nullFixed++;
      }
    }
  }

  // Step 2: Fix cross-city misallocations (e.g. "Kakkanad, Kochi" pointing to Pune)
  for (const a of allAreas) {
    const areaName = (a.name || '').trim();
    const cityDoc = a.city;
    const currentCityName = (cityDoc ? cityDoc.name : a.cityName || '').trim().toLowerCase();

    for (const [cityNameKey, targetCity] of cityByName.entries()) {
      if (cityNameKey === currentCityName) continue;
      // If area name explicitly ends with e.g. ", kochi" or contains "(kochi)"
      const endsWithCity = areaName.toLowerCase().endsWith(`, ${cityNameKey}`);
      const hasCityParen = areaName.toLowerCase().includes(`(${cityNameKey})`);
      if (endsWithCity || hasCityParen) {
        console.log(`Re-linking [${areaName}] from [${currentCityName}] -> [${targetCity.name}]`);
        const existingInTarget = await Area.findOne({
          city: targetCity._id,
          name: { $regex: new RegExp(`^${areaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        });

        if (existingInTarget) {
          // Target city already has this area. Re-point any PGs/properties, then delete the duplicate
          await Promise.all([
            PG.updateMany({ areaId: a._id }, { $set: { areaId: existingInTarget._id, city: targetCity.name } }),
            Property.updateMany({ areaId: a._id }, { $set: { areaId: existingInTarget._id, city: targetCity.name } }),
          ]);
          await Area.deleteOne({ _id: a._id });
          console.log(`  Merged duplicate into existing target area [${existingInTarget._id}]`);
        } else {
          await Area.updateOne(
            { _id: a._id },
            { $set: { city: targetCity._id, cityName: targetCity.name } }
          );
        }
        crossCityFixed++;
        break;
      }
    }
  }

  // Step 3: Deactivate duplicates in the same city (keep the one with lowest order / most active)
  const remainingAreas = await Area.find().sort({ order: 1, _id: 1 }).lean();
  const seenInCity = new Map();

  for (const a of remainingAreas) {
    const cityIdStr = String(a.city || a.cityName || '');
    const normName = (a.name || '').trim().toLowerCase();
    const key = `${cityIdStr}:${normName}`;

    if (seenInCity.has(key)) {
      // Check if duplicate has properties assigned; if not, mark isActive: false
      const primaryId = seenInCity.get(key);
      const [pgCount, propCount] = await Promise.all([
        PG.countDocuments({ area: a.name }),
        Property.countDocuments({ area: a.name }),
      ]);
      if (pgCount === 0 && propCount === 0) {
        await Area.updateOne({ _id: a._id }, { $set: { isActive: false } });
        duplicatesCleaned++;
      }
    } else {
      seenInCity.set(key, a._id);
    }
  }

  console.log('\n=== AREA CLEANUP COMPLETE ===');
  console.log(`✓ Null city references fixed: ${nullFixed}`);
  console.log(`✓ Cross-city misallocated areas re-linked: ${crossCityFixed}`);
  console.log(`✓ Inactive duplicate areas marked: ${duplicatesCleaned}`);

  await mongoose.disconnect();
}

auditAndFixAreas().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});

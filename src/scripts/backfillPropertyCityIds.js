/**
 * Backfill Property.cityId from the managed City catalog.
 *
 * Dry run:
 *   node src/scripts/backfillPropertyCityIds.js
 * Apply changes:
 *   node src/scripts/backfillPropertyCityIds.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Property = require('../models/Property.model');
const City = require('../models/City.model');

const normalize = (value) => String(value || '').trim().toLowerCase();

const buildCityIndex = (cities) => {
  const index = new Map();
  const ambiguous = new Set();

  for (const city of cities) {
    const key = normalize(city.name);
    if (!key) continue;
    if (index.has(key) && String(index.get(key)._id) !== String(city._id)) {
      ambiguous.add(key);
    } else {
      index.set(key, city);
    }
  }

  for (const city of cities) {
    for (const label of city.aliases || []) {
      const key = normalize(label);
      if (!key || index.has(key) || ambiguous.has(key)) continue;
      index.set(key, city);
    }
  }

  for (const key of ambiguous) index.delete(key);
  return { index, ambiguous };
};

async function backfillPropertyCityIds({ apply = false } = {}) {
  await connectDB();

  const [cities, properties] = await Promise.all([
    City.find({ isActive: true }).select('_id name aliases').lean(),
    Property.find({ city: { $type: 'string' } }).select('_id city cityId').lean(),
  ]);

  const { index, ambiguous } = buildCityIndex(cities);
  const operations = [];
  const unresolved = new Map();
  let alreadyLinked = 0;
  let matched = 0;

  for (const property of properties) {
    if (property.cityId) {
      alreadyLinked += 1;
      continue;
    }

    const city = index.get(normalize(property.city));
    if (!city) {
      const label = String(property.city).trim();
      unresolved.set(label, (unresolved.get(label) || 0) + 1);
      continue;
    }

    matched += 1;
    operations.push({
      updateOne: {
        filter: { _id: property._id, cityId: { $exists: false } },
        update: { $set: { cityId: city._id, city: city.name } },
      },
    });
  }

  if (apply && operations.length > 0) {
    await Property.bulkWrite(operations, { ordered: false });
  }

  if (apply) {
    await Property.collection.createIndex({ cityId: 1, status: 1 });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    totalProperties: properties.length,
    alreadyLinked,
    matched,
    updated: apply ? operations.length : 0,
    unresolved: Object.fromEntries([...unresolved.entries()].sort((a, b) => b[1] - a[1])),
    ambiguousLabels: [...ambiguous].sort(),
  }, null, 2));

  await mongoose.disconnect();
}

if (require.main === module) {
  backfillPropertyCityIds({ apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Property city backfill failed:', error);
      process.exit(1);
    });
}

module.exports = backfillPropertyCityIds;

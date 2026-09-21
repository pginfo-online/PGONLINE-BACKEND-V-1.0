const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/ADMIN/Desktop/pgInfoonline/backend/.env' });

async function migrateFood() {
  const isApply = process.argv.includes('--apply');
  console.log(`Connecting to MongoDB... (Mode: ${isApply ? 'APPLY' : 'DRY RUN'})`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  const Property = mongoose.model('Property', new mongoose.Schema({}, { strict: false }));
  const PG = mongoose.model('PG', new mongoose.Schema({}, { strict: false }));

  // 1. Normalize properties collection
  console.log('\n--- Normalizing properties collection ---');
  const properties = await Property.find({ category: 'pg' }).lean();
  console.log(`Found ${properties.length} PG properties.`);

  const propOps = [];
  for (const doc of properties) {
    const rawPG = doc.pgDetails || {};
    const hasFood = (rawPG.food && rawPG.food !== 'none') || rawPG.foodInfo?.provided === true;
    const resolvedFood = (rawPG.food && rawPG.food !== 'none')
      ? rawPG.food
      : (rawPG.foodInfo?.type && rawPG.foodInfo.type !== 'none')
        ? rawPG.foodInfo.type
        : (hasFood ? 'both' : 'none');

    const foodInc = hasFood ? (rawPG.foodIncluded ?? rawPG.foodInfo?.includedInRent ?? false) : false;
    const rawFoodInfo = rawPG.foodInfo || {};
    const foodCost = (hasFood && !foodInc)
      ? (rawFoodInfo.mealCostPerMonth ?? rawFoodInfo.monthlyFoodCharge ?? 0)
      : 0;

    const currentTimings = rawFoodInfo.mealTimings || rawFoodInfo.dailySchedule || {};
    const breakfast = {
      provided: currentTimings.breakfast?.provided !== false,
      from: currentTimings.breakfast?.from || currentTimings.breakfast?.start || '07:30',
      to: currentTimings.breakfast?.to || currentTimings.breakfast?.end || '09:30',
    };
    const lunch = {
      provided: !!currentTimings.lunch?.provided,
      from: currentTimings.lunch?.from || currentTimings.lunch?.start || '12:30',
      to: currentTimings.lunch?.to || currentTimings.lunch?.end || '14:30',
    };
    const dinner = {
      provided: currentTimings.dinner?.provided !== false,
      from: currentTimings.dinner?.from || currentTimings.dinner?.start || '19:30',
      to: currentTimings.dinner?.to || currentTimings.dinner?.end || '21:30',
    };

    const needsUpdate =
      rawPG.food !== (hasFood ? resolvedFood : 'none') ||
      rawPG.foodIncluded !== foodInc ||
      rawFoodInfo.provided !== hasFood ||
      rawFoodInfo.type !== (hasFood ? resolvedFood : 'veg') ||
      rawFoodInfo.includedInRent !== foodInc ||
      !rawFoodInfo.mealTimings;

    if (needsUpdate) {
      propOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              'pgDetails.food': hasFood ? resolvedFood : 'none',
              'pgDetails.foodIncluded': foodInc,
              'pgDetails.foodInfo.provided': hasFood,
              'pgDetails.foodInfo.type': hasFood ? resolvedFood : 'veg',
              'pgDetails.foodInfo.includedInRent': foodInc,
              'pgDetails.foodInfo.mealCostPerMonth': foodCost,
              'pgDetails.foodInfo.monthlyFoodCharge': foodCost,
              'pgDetails.foodInfo.messType': rawFoodInfo.messType || 'in-house',
              'pgDetails.foodInfo.mealsPerDay': rawFoodInfo.mealsPerDay || (lunch.provided ? 3 : 2),
              'pgDetails.foodInfo.kitchenAccess': rawFoodInfo.kitchenAccess ?? rawFoodInfo.kitchenAccessForTenants ?? false,
              'pgDetails.foodInfo.kitchenHours': rawFoodInfo.kitchenHours || '',
              'pgDetails.foodInfo.mealTimings': { breakfast, lunch, dinner },
            },
          },
        },
      });
    }
  }

  console.log(`Properties requiring food normalization: ${propOps.length} / ${properties.length}`);
  if (isApply && propOps.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < propOps.length; i += CHUNK_SIZE) {
      const chunk = propOps.slice(i, i + CHUNK_SIZE);
      const res = await Property.bulkWrite(chunk);
      console.log(`Bulk wrote properties chunk ${i + 1}-${i + chunk.length}: ${res.modifiedCount} modified.`);
    }
  }

  // 2. Normalize pgs collection
  console.log('\n--- Normalizing pgs collection ---');
  const pgs = await PG.find({}).lean();
  console.log(`Found ${pgs.length} PGs.`);

  const pgOps = [];
  for (const doc of pgs) {
    const hasFood = (doc.food && doc.food !== 'none') || doc.foodInfo?.provided === true;
    const resolvedFood = (doc.food && doc.food !== 'none')
      ? doc.food
      : (doc.foodInfo?.type && doc.foodInfo.type !== 'none')
        ? doc.foodInfo.type
        : (hasFood ? 'both' : 'none');

    const foodInc = hasFood ? (doc.foodIncluded ?? doc.foodInfo?.includedInRent ?? false) : false;
    const rawFoodInfo = doc.foodInfo || {};
    const foodCost = (hasFood && !foodInc)
      ? (rawFoodInfo.mealCostPerMonth ?? rawFoodInfo.monthlyFoodCharge ?? 0)
      : 0;

    const currentTimings = rawFoodInfo.mealTimings || rawFoodInfo.dailySchedule || {};
    const breakfast = {
      provided: currentTimings.breakfast?.provided !== false,
      from: currentTimings.breakfast?.from || currentTimings.breakfast?.start || '07:30',
      to: currentTimings.breakfast?.to || currentTimings.breakfast?.end || '09:30',
    };
    const lunch = {
      provided: !!currentTimings.lunch?.provided,
      from: currentTimings.lunch?.from || currentTimings.lunch?.start || '12:30',
      to: currentTimings.lunch?.to || currentTimings.lunch?.end || '14:30',
    };
    const dinner = {
      provided: currentTimings.dinner?.provided !== false,
      from: currentTimings.dinner?.from || currentTimings.dinner?.start || '19:30',
      to: currentTimings.dinner?.to || currentTimings.dinner?.end || '21:30',
    };

    const needsUpdate =
      doc.food !== (hasFood ? resolvedFood : 'none') ||
      doc.foodIncluded !== foodInc ||
      rawFoodInfo.provided !== hasFood ||
      rawFoodInfo.type !== (hasFood ? resolvedFood : 'veg') ||
      rawFoodInfo.includedInRent !== foodInc ||
      !rawFoodInfo.mealTimings;

    if (needsUpdate) {
      pgOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              food: hasFood ? resolvedFood : 'none',
              foodIncluded: foodInc,
              'foodInfo.provided': hasFood,
              'foodInfo.type': hasFood ? resolvedFood : 'veg',
              'foodInfo.includedInRent': foodInc,
              'foodInfo.mealCostPerMonth': foodCost,
              'foodInfo.monthlyFoodCharge': foodCost,
              'foodInfo.messType': rawFoodInfo.messType || 'in-house',
              'foodInfo.mealsPerDay': rawFoodInfo.mealsPerDay || (lunch.provided ? 3 : 2),
              'foodInfo.kitchenAccess': rawFoodInfo.kitchenAccess ?? rawFoodInfo.kitchenAccessForTenants ?? false,
              'foodInfo.kitchenHours': rawFoodInfo.kitchenHours || '',
              'foodInfo.mealTimings': { breakfast, lunch, dinner },
            },
          },
        },
      });
    }
  }

  console.log(`PGs requiring food normalization: ${pgOps.length} / ${pgs.length}`);
  if (isApply && pgOps.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < pgOps.length; i += CHUNK_SIZE) {
      const chunk = pgOps.slice(i, i + CHUNK_SIZE);
      const res = await PG.bulkWrite(chunk);
      console.log(`Bulk wrote pgs chunk ${i + 1}-${i + chunk.length}: ${res.modifiedCount} modified.`);
    }
  }

  await mongoose.disconnect();
  console.log('\nMigration complete successfully.');
}

migrateFood().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

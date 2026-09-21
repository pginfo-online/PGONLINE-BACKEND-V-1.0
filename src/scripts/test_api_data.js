const path = require('path');
const mongoose = require('mongoose');
const backendModules = 'c:/Users/ADMIN/Desktop/pgInfoonline/backend/node_modules';
require(path.join(backendModules, 'dotenv')).config({ path: 'c:/Users/ADMIN/Desktop/pgInfoonline/backend/.env' });
const connectDB = require('../config/db');

async function testApiData() {
  try {
    await connectDB();
    const Property = require('../models/Property.model');
    const propertyService = require('../services/property.service');

    console.log('Testing getPropertyById with synthesized roomConfigs and photos...');
    // Find a random PG property
    const sample = await Property.findOne({ category: 'pg' }).lean();
    console.log(`Testing Property ID: ${sample._id}, Title: "${sample.title}"`);
    console.log(`  expectedPrice: ${sample.pricing?.expectedPrice}`);
    console.log(`  roomConfigs count: ${sample.pgDetails?.roomConfigs?.length}`);
    if (sample.pgDetails?.roomConfigs?.length > 0) {
      console.log(`  first roomConfig:`, sample.pgDetails.roomConfigs[0]);
    }
    console.log(`  photos count: ${sample.photos?.length}`);
    if (sample.photos?.length > 0) {
      console.log(`  first photo:`, sample.photos[0]);
    }

    // Verify properties for owner 6a716669785e054ce4bae80c
    const ownerId = new mongoose.Types.ObjectId("6a716669785e054ce4bae80c");
    const ownerProps = await Property.find({ owner: ownerId }).limit(5).lean();
    console.log(`\nOwner 6a716669785e054ce4bae80c sample listings:`);
    ownerProps.forEach((p, idx) => {
      console.log(`  [${idx+1}] Title: "${p.title}", Photos: ${p.photos?.length}, Price: ₹${p.pricing?.expectedPrice}`);
    });

    await mongoose.disconnect();
    console.log('\nAll checks passed successfully!');
  } catch (err) {
    console.error('Test error:', err);
  }
}

testApiData();

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const Property = require('../models/Property.model');
const { updatePropertySchema } = require('../validators/property.validator');

async function checkValidation() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Find a PG property
  const prop = await Property.findOne({ category: 'pg' }).lean();
  if (!prop) {
    console.log('No PG property found');
    process.exit(0);
  }

  console.log('Found property:', prop.title, 'category:', prop.category);
  console.log('residentialDetails in DB:', prop.residentialDetails);
  console.log('commercialDetails in DB:', prop.commercialDetails);

  // Simulate what frontend sends in payload
  const result = updatePropertySchema.safeParse(prop);
  if (!result.success) {
    console.log('Validation failed with errors:');
    console.log(JSON.stringify(result.error.errors, null, 2));
  } else {
    console.log('Validation PASSED!');
  }

  await mongoose.disconnect();
}

checkValidation().catch(console.error);

/**
 * seedCities.js — Comprehensive Indian City Seeder
 *
 * Seeds all major Indian cities across all 28 states + 8 UTs with:
 *  - Correct state mapping
 *  - Tier classification (1=metro, 10=major, 50=tier-2, 99=tier-3)
 *  - Aliases for alternate / colloquial names
 *  - Idempotent: uses findOneAndUpdate with upsert (safe to re-run)
 *
 * Usage:
 *   node src/scripts/seedCities.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const City = require('../models/City.model');

// ─── City Seed Data ───────────────────────────────────────────────────────────
// Format: { name, state, country, order, aliases }
// order: 1=Tier-1 Metro, 10=Tier-2 Major, 50=Tier-3, 99=Tier-4/Small

const CITIES = [
  // ── Tier-1 Metros ──────────────────────────────────────────────────────────
  { name: 'Mumbai',          state: 'Maharashtra',       order: 1,  aliases: ['Bombay'] },
  { name: 'Delhi',           state: 'Delhi',              order: 1,  aliases: ['New Delhi', 'NCR', 'Delhi NCR'] },
  { name: 'Bengaluru',       state: 'Karnataka',          order: 1,  aliases: ['Bangalore', 'Bangaluru'] },
  { name: 'Hyderabad',       state: 'Telangana',          order: 1,  aliases: ['Hyd', 'Cyberabad'] },
  { name: 'Chennai',         state: 'Tamil Nadu',         order: 1,  aliases: ['Madras'] },
  { name: 'Kolkata',         state: 'West Bengal',        order: 1,  aliases: ['Calcutta'] },
  { name: 'Pune',            state: 'Maharashtra',        order: 1,  aliases: ['Poona'] },
  { name: 'Ahmedabad',       state: 'Gujarat',            order: 1,  aliases: ['Amdavad'] },

  // ── Tier-2 Major Cities ────────────────────────────────────────────────────
  { name: 'Jaipur',          state: 'Rajasthan',          order: 10, aliases: ['Pink City'] },
  { name: 'Gurugram',        state: 'Haryana',            order: 10, aliases: ['Gurgaon'] },
  { name: 'Noida',           state: 'Uttar Pradesh',      order: 10, aliases: ['New Okhla Industrial Development Authority'] },
  { name: 'Surat',           state: 'Gujarat',            order: 10, aliases: ['Diamond City'] },
  { name: 'Lucknow',         state: 'Uttar Pradesh',      order: 10, aliases: ['Nawabi City'] },
  { name: 'Kanpur',          state: 'Uttar Pradesh',      order: 10, aliases: [] },
  { name: 'Nagpur',          state: 'Maharashtra',        order: 10, aliases: ['Orange City'] },
  { name: 'Indore',          state: 'Madhya Pradesh',     order: 10, aliases: ['Mini Mumbai'] },
  { name: 'Thane',           state: 'Maharashtra',        order: 10, aliases: [] },
  { name: 'Bhopal',          state: 'Madhya Pradesh',     order: 10, aliases: ['City of Lakes'] },
  { name: 'Visakhapatnam',   state: 'Andhra Pradesh',     order: 10, aliases: ['Vizag'] },
  { name: 'Pimpri-Chinchwad',state: 'Maharashtra',        order: 10, aliases: ['Pimpri Chinchwad', 'PCMC'] },
  { name: 'Patna',           state: 'Bihar',              order: 10, aliases: [] },
  { name: 'Vadodara',        state: 'Gujarat',            order: 10, aliases: ['Baroda'] },
  { name: 'Ghaziabad',       state: 'Uttar Pradesh',      order: 10, aliases: [] },
  { name: 'Ludhiana',        state: 'Punjab',             order: 10, aliases: [] },
  { name: 'Agra',            state: 'Uttar Pradesh',      order: 10, aliases: ['Taj City'] },
  { name: 'Nashik',          state: 'Maharashtra',        order: 10, aliases: ['Nasik', 'Wine Capital of India'] },
  { name: 'Faridabad',       state: 'Haryana',            order: 10, aliases: [] },
  { name: 'Meerut',          state: 'Uttar Pradesh',      order: 10, aliases: [] },
  { name: 'Rajkot',          state: 'Gujarat',            order: 10, aliases: [] },
  { name: 'Varanasi',        state: 'Uttar Pradesh',      order: 10, aliases: ['Banaras', 'Benares', 'Kashi'] },
  { name: 'Srinagar',        state: 'Jammu & Kashmir',    order: 10, aliases: [] },
  { name: 'Aurangabad',      state: 'Maharashtra',        order: 10, aliases: ['Chhatrapati Sambhajinagar'] },
  { name: 'Dhanbad',         state: 'Jharkhand',          order: 10, aliases: ['Coal City'] },
  { name: 'Amritsar',        state: 'Punjab',             order: 10, aliases: ['Holy City'] },
  { name: 'Allahabad',       state: 'Uttar Pradesh',      order: 10, aliases: ['Prayagraj', 'Prayag'] },
  { name: 'Ranchi',          state: 'Jharkhand',          order: 10, aliases: [] },
  { name: 'Howrah',          state: 'West Bengal',        order: 10, aliases: [] },
  { name: 'Coimbatore',      state: 'Tamil Nadu',         order: 10, aliases: ['Kovai'] },
  { name: 'Jabalpur',        state: 'Madhya Pradesh',     order: 10, aliases: [] },
  { name: 'Gwalior',         state: 'Madhya Pradesh',     order: 10, aliases: [] },
  { name: 'Vijayawada',      state: 'Andhra Pradesh',     order: 10, aliases: ['Bezawada'] },
  { name: 'Jodhpur',         state: 'Rajasthan',          order: 10, aliases: ['Blue City', 'Sun City'] },
  { name: 'Madurai',         state: 'Tamil Nadu',         order: 10, aliases: ['Temple City'] },
  { name: 'Raipur',          state: 'Chhattisgarh',       order: 10, aliases: [] },
  { name: 'Kota',            state: 'Rajasthan',          order: 10, aliases: ['Education City'] },
  { name: 'Guwahati',        state: 'Assam',              order: 10, aliases: ['Gauhati'] },
  { name: 'Chandigarh',      state: 'Chandigarh',         order: 10, aliases: ['City Beautiful'] },
  { name: 'Solapur',         state: 'Maharashtra',        order: 10, aliases: ['Sholapur'] },
  { name: 'Hubballi',        state: 'Karnataka',          order: 10, aliases: ['Hubli', 'Hubli-Dharwad'] },
  { name: 'Tiruchirappalli', state: 'Tamil Nadu',         order: 10, aliases: ['Trichy', 'Tiruchi'] },
  { name: 'Bareilly',        state: 'Uttar Pradesh',      order: 10, aliases: [] },
  { name: 'Moradabad',       state: 'Uttar Pradesh',      order: 10, aliases: [] },
  { name: 'Mysuru',          state: 'Karnataka',          order: 10, aliases: ['Mysore'] },
  { name: 'Gurgaon',         state: 'Haryana',            order: 10, aliases: ['Gurugram'] },

  // ── Tier-2 Additional Cities ───────────────────────────────────────────────
  { name: 'Navi Mumbai',     state: 'Maharashtra',        order: 50, aliases: ['New Mumbai'] },
  { name: 'Greater Noida',   state: 'Uttar Pradesh',      order: 50, aliases: ['Greater Noida West'] },
  { name: 'Noida Extension', state: 'Uttar Pradesh',      order: 50, aliases: ['Greater Noida West'] },
  { name: 'Kalyan',          state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Vasai-Virar',     state: 'Maharashtra',        order: 50, aliases: ['Vasai', 'Virar'] },
  { name: 'Thiruvananthapuram', state: 'Kerala',          order: 50, aliases: ['Trivandrum'] },
  { name: 'Kochi',           state: 'Kerala',             order: 50, aliases: ['Cochin', 'Ernakulam'] },
  { name: 'Kozhikode',       state: 'Kerala',             order: 50, aliases: ['Calicut'] },
  { name: 'Thrissur',        state: 'Kerala',             order: 50, aliases: ['Trichur'] },
  { name: 'Kollam',          state: 'Kerala',             order: 50, aliases: ['Quilon'] },
  { name: 'Kannur',          state: 'Kerala',             order: 50, aliases: ['Cannanore'] },
  { name: 'Udaipur',         state: 'Rajasthan',          order: 50, aliases: ['City of Lakes', 'Venice of East'] },
  { name: 'Ajmer',           state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Bikaner',         state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Alwar',           state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Bhilwara',        state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Sikar',           state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Pali',            state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Bharatpur',       state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Mangaluru',       state: 'Karnataka',          order: 50, aliases: ['Mangalore'] },
  { name: 'Belagavi',        state: 'Karnataka',          order: 50, aliases: ['Belgaum'] },
  { name: 'Tumakuru',        state: 'Karnataka',          order: 50, aliases: ['Tumkur'] },
  { name: 'Davangere',       state: 'Karnataka',          order: 50, aliases: ['Davanagere'] },
  { name: 'Bellary',         state: 'Karnataka',          order: 50, aliases: ['Ballari'] },
  { name: 'Shimoga',         state: 'Karnataka',          order: 50, aliases: ['Shivamogga'] },
  { name: 'Kolhapur',        state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Amravati',        state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Jalgaon',         state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Akola',           state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Latur',           state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Dhule',           state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Ahmednagar',      state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Nanded',          state: 'Maharashtra',        order: 50, aliases: [] },
  { name: 'Salem',           state: 'Tamil Nadu',         order: 50, aliases: [] },
  { name: 'Tiruppur',        state: 'Tamil Nadu',         order: 50, aliases: ['Tirupur'] },
  { name: 'Tirunelveli',     state: 'Tamil Nadu',         order: 50, aliases: ['Nellai'] },
  { name: 'Vellore',         state: 'Tamil Nadu',         order: 50, aliases: [] },
  { name: 'Erode',           state: 'Tamil Nadu',         order: 50, aliases: [] },
  { name: 'Thoothukudi',     state: 'Tamil Nadu',         order: 50, aliases: ['Tuticorin'] },
  { name: 'Gandhinagar',     state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Jamnagar',        state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Junagadh',        state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Anand',           state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Bhavnagar',       state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Ankleshwar',      state: 'Gujarat',            order: 50, aliases: [] },
  { name: 'Bhubaneswar',     state: 'Odisha',             order: 50, aliases: ['Temple City of India'] },
  { name: 'Cuttack',         state: 'Odisha',             order: 50, aliases: ['Silver City'] },
  { name: 'Rourkela',        state: 'Odisha',             order: 50, aliases: [] },
  { name: 'Vishakhapatnam',  state: 'Andhra Pradesh',     order: 50, aliases: ['Vizag', 'Visakhapatnam'] },
  { name: 'Guntur',          state: 'Andhra Pradesh',     order: 50, aliases: [] },
  { name: 'Nellore',         state: 'Andhra Pradesh',     order: 50, aliases: [] },
  { name: 'Kurnool',         state: 'Andhra Pradesh',     order: 50, aliases: [] },
  { name: 'Tirupati',        state: 'Andhra Pradesh',     order: 50, aliases: [] },
  { name: 'Warangal',        state: 'Telangana',          order: 50, aliases: [] },
  { name: 'Nizamabad',       state: 'Telangana',          order: 50, aliases: [] },
  { name: 'Karimnagar',      state: 'Telangana',          order: 50, aliases: [] },
  { name: 'Khammam',         state: 'Telangana',          order: 50, aliases: [] },
  { name: 'Dehradun',        state: 'Uttarakhand',        order: 50, aliases: [] },
  { name: 'Haridwar',        state: 'Uttarakhand',        order: 50, aliases: ['Hardwar'] },
  { name: 'Roorkee',         state: 'Uttarakhand',        order: 50, aliases: [] },
  { name: 'Haldwani',        state: 'Uttarakhand',        order: 50, aliases: [] },
  { name: 'Shimla',          state: 'Himachal Pradesh',   order: 50, aliases: [] },
  { name: 'Jammu',           state: 'Jammu & Kashmir',    order: 50, aliases: [] },
  { name: 'Leh',             state: 'Ladakh',             order: 50, aliases: [] },
  { name: 'Goa',             state: 'Goa',                order: 50, aliases: ['Panaji', 'North Goa', 'South Goa'] },
  { name: 'Panaji',          state: 'Goa',                order: 50, aliases: ['Panjim'] },
  { name: 'Margao',          state: 'Goa',                order: 50, aliases: ['Madgaon'] },
  { name: 'Vasco da Gama',   state: 'Goa',                order: 50, aliases: ['Vasco'] },
  { name: 'Puducherry',      state: 'Puducherry',         order: 50, aliases: ['Pondicherry', 'Pondy'] },
  { name: 'Siliguri',        state: 'West Bengal',        order: 50, aliases: [] },
  { name: 'Asansol',         state: 'West Bengal',        order: 50, aliases: [] },
  { name: 'Durgapur',        state: 'West Bengal',        order: 50, aliases: [] },
  { name: 'Bardhaman',       state: 'West Bengal',        order: 50, aliases: ['Burdwan'] },
  { name: 'Agartala',        state: 'Tripura',            order: 50, aliases: [] },
  { name: 'Imphal',          state: 'Manipur',            order: 50, aliases: [] },
  { name: 'Shillong',        state: 'Meghalaya',          order: 50, aliases: [] },
  { name: 'Aizawl',          state: 'Mizoram',            order: 50, aliases: [] },
  { name: 'Kohima',          state: 'Nagaland',           order: 50, aliases: [] },
  { name: 'Itanagar',        state: 'Arunachal Pradesh',  order: 50, aliases: [] },
  { name: 'Gangtok',         state: 'Sikkim',             order: 50, aliases: [] },
  { name: 'Dispur',          state: 'Assam',              order: 50, aliases: [] },
  { name: 'Dibrugarh',       state: 'Assam',              order: 50, aliases: [] },
  { name: 'Silchar',         state: 'Assam',              order: 50, aliases: [] },
  { name: 'Guwahati',        state: 'Assam',              order: 10, aliases: ['Gauhati'] },
  { name: 'Bilaspur',        state: 'Chhattisgarh',       order: 50, aliases: [] },
  { name: 'Bhilai',          state: 'Chhattisgarh',       order: 50, aliases: [] },
  { name: 'Durg',            state: 'Chhattisgarh',       order: 50, aliases: [] },
  { name: 'Korba',           state: 'Chhattisgarh',       order: 50, aliases: [] },
  { name: 'Jamshedpur',      state: 'Jharkhand',          order: 50, aliases: ['Steel City'] },
  { name: 'Bokaro',          state: 'Jharkhand',          order: 50, aliases: ['Bokaro Steel City'] },
  { name: 'Hazaribagh',      state: 'Jharkhand',          order: 50, aliases: [] },
  { name: 'Dhanbad',         state: 'Jharkhand',          order: 10, aliases: [] },
  { name: 'Muzaffarpur',     state: 'Bihar',              order: 50, aliases: [] },
  { name: 'Bhagalpur',       state: 'Bihar',              order: 50, aliases: [] },
  { name: 'Gaya',            state: 'Bihar',              order: 50, aliases: [] },
  { name: 'Darbhanga',       state: 'Bihar',              order: 50, aliases: [] },
  { name: 'Purnea',          state: 'Bihar',              order: 50, aliases: [] },
  { name: 'Gorakhpur',       state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Mathura',         state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Aligarh',         state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Bareilly',        state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Saharanpur',      state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Firozabad',       state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Jhansi',          state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Muzaffarnagar',   state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Hapur',           state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Etawah',          state: 'Uttar Pradesh',      order: 50, aliases: [] },
  { name: 'Rohtak',          state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Hisar',           state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Karnal',          state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Panipat',         state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Ambala',          state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Yamunanagar',     state: 'Haryana',            order: 50, aliases: [] },
  { name: 'Ludhiana',        state: 'Punjab',             order: 10, aliases: [] },
  { name: 'Jalandhar',       state: 'Punjab',             order: 50, aliases: [] },
  { name: 'Patiala',         state: 'Punjab',             order: 50, aliases: [] },
  { name: 'Bathinda',        state: 'Punjab',             order: 50, aliases: [] },
  { name: 'Mohali',          state: 'Punjab',             order: 50, aliases: ['SAS Nagar'] },
  { name: 'Ajmer',           state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Bhilwara',        state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Ganganagar',      state: 'Rajasthan',          order: 50, aliases: ['Sri Ganganagar', 'Sriganganagar'] },
  { name: 'Hanumangarh',     state: 'Rajasthan',          order: 50, aliases: [] },
  { name: 'Chittorgarh',     state: 'Rajasthan',          order: 50, aliases: ['Chittor'] },
  { name: 'Tonk',            state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Sawai Madhopur',  state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Dungarpur',       state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Barmer',          state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Jaisalmer',       state: 'Rajasthan',          order: 99, aliases: ['Golden City'] },
  { name: 'Dhaulpur',        state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Bundi',           state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Nathdwara',       state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Mount Abu',       state: 'Rajasthan',          order: 99, aliases: [] },
  { name: 'Nagaur',          state: 'Rajasthan',          order: 99, aliases: [] },

  // ── NCR Specific ──────────────────────────────────────────────────────────
  { name: 'Ghaziabad',       state: 'Uttar Pradesh',      order: 10, aliases: ['Raj Nagar Extension', 'Indirapuram'] },
  { name: 'Faridabad',       state: 'Haryana',            order: 10, aliases: [] },
  { name: 'Meerut',          state: 'Uttar Pradesh',      order: 10, aliases: [] },
];

// ─── Deduplication ─────────────────────────────────────────────────────────────
// Remove duplicate name+state combos from seed array (keep first occurrence)
const seen = new Set();
const UNIQUE_CITIES = CITIES.filter((c) => {
  const key = `${c.name.toLowerCase()}__${c.state.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// ─── Seeder ───────────────────────────────────────────────────────────────────
async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`[seedCities] Connected to MongoDB. Seeding ${UNIQUE_CITIES.length} cities...`);

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const city of UNIQUE_CITIES) {
    const slug = city.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    try {
      const result = await City.findOneAndUpdate(
        { name: { $regex: new RegExp(`^${city.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        {
          $setOnInsert: {
            name: city.name,
            slug,
            isActive: true,
          },
          $addToSet: { aliases: { $each: city.aliases || [] } },
          $set: {
            state: city.state,
            order: city.order,
            country: city.country || 'India',
          },
        },
        { upsert: true, new: false, runValidators: false }
      );

      if (!result) {
        created++;
        console.log(`  ✅ Created: ${city.name} (${city.state})`);
      } else {
        updated++;
        // console.log(`  ↩  Updated: ${city.name} (${city.state})`);
      }
    } catch (err) {
      if (err.code === 11000) {
        skipped++;
        // console.log(`  ⚠  Duplicate slug skipped: ${city.name}`);
      } else {
        console.error(`  ❌ Error for ${city.name}: ${err.message}`);
      }
    }
  }

  const total = await City.countDocuments();
  console.log(`\n[seedCities] Done!`);
  console.log(`  Created: ${created}  |  Updated: ${updated}  |  Skipped (dup): ${skipped}`);
  console.log(`  Total cities in DB: ${total}`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[seedCities] Fatal error:', err);
  process.exit(1);
});

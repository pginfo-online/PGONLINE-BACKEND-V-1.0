const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const HotDealCategory = require('../models/HotDealCategory.model');
const { logger } = require('../utils/logger');

const INITIAL_CATEGORIES = [
  { name: 'Cleaning & Laundry', icon: '🧹', color: '#64748B', order: 1, description: 'House cleaning, laundry & dry-cleaning deals' },
  { name: 'Moving & Shifting', icon: '📦', color: '#8B5CF6', order: 2, description: 'Packers, movers & relocation services' },
  { name: 'Fitness & Wellness', icon: '💪', color: '#10B981', order: 3, description: 'Gym memberships, yoga, spa & wellness deals' },
  { name: 'Internet & Services', icon: '🌐', color: '#3B82F6', order: 4, description: 'Broadband, DTH, mobile plans & utility services' },
  { name: 'Shopping', icon: '🛍️', color: '#F43F5E', order: 5, description: 'Fashion, groceries, home & lifestyle shopping' },
  { name: 'Electronics', icon: '📱', color: '#6366F1', order: 6, description: 'Phones, laptops, gadgets & accessories' },
  { name: 'Beauty & Salon', icon: '💄', color: '#EC4899', order: 7, description: 'Haircuts, facials, nail art & beauty services' },
  { name: 'Travel', icon: '✈️', color: '#06B6D4', order: 8, description: 'Flights, hotels, trips & travel packages' },
  { name: 'Entertainment', icon: '🎭', color: '#F59E0B', order: 9, description: 'Movies, events, gaming & OTT subscriptions' },
  { name: 'Bills', icon: '💡', color: '#84CC16', order: 10, description: 'Electricity, water, gas & utility bill payments' },
];

async function seed() {
  try {
    await connectDB();
    logger.info('Connected to MongoDB');

    let created = 0;
    let skipped = 0;

    for (const cat of INITIAL_CATEGORIES) {
      const slug = cat.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const exists = await HotDealCategory.findOne({ slug });
      if (exists) {
        logger.info(`  Skipped (exists): ${cat.name}`);
        skipped++;
        continue;
      }
      await HotDealCategory.create({ ...cat, slug, displayName: cat.name });
      logger.info(`  Created: ${cat.icon} ${cat.name}`);
      created++;
    }

    logger.info(`\n✅ Seed complete. Created: ${created}, Skipped: ${skipped}`);
    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${err.message}`);
    process.exit(1);
  }
}

seed();

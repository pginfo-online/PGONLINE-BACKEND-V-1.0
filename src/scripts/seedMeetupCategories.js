const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const MeetupCategory = require('../models/MeetupCategory.model');
const { logger } = require('../utils/logger');

const INITIAL_CATEGORIES = [
  { name: 'Tech & Coding', icon: '💻', color: '#4F46E5', order: 1, description: 'AI, coding, web development, hackathons & tech talks' },
  { name: 'Career & Networking', icon: '💼', color: '#0284C7', order: 2, description: 'Job hunting, startup pitch, networking & career growth' },
  { name: 'Fitness & Sports', icon: '🏃', color: '#10B981', order: 3, description: 'Running, badminton, football, gym & yoga groups' },
  { name: 'Gaming & Boardgames', icon: '🎮', color: '#8B5CF6', order: 4, description: 'LAN parties, board games, esports & trivia nights' },
  { name: 'Arts & Creative', icon: '🎨', color: '#EC4899', order: 5, description: 'Painting, pottery, sketching, DIY & creative workshops' },
  { name: 'Photography & Film', icon: '📸', color: '#F59E0B', order: 6, description: 'Photo walks, filmmaking, movie screenings & critiques' },
  { name: 'Food & Hangouts', icon: '🍕', color: '#F97316', order: 7, description: 'Food trails, cafe hopping, potlucks & social dinners' },
  { name: 'Language & Culture', icon: '🌍', color: '#06B6D4', order: 8, description: 'Language exchange, cultural events & celebrations' },
  { name: 'Books & Discussions', icon: '📚', color: '#84CC16', order: 9, description: 'Book clubs, philosophy, debates & storytelling' },
  { name: 'Trekking & Outdoors', icon: '🏕️', color: '#14B8A6', order: 10, description: 'Weekend treks, camping, stargazing & road trips' },
];

async function seed() {
  try {
    await connectDB();
    logger.info('Connected to MongoDB for MeetupCategory seeding');

    let created = 0;
    let updated = 0;

    for (const cat of INITIAL_CATEGORIES) {
      const existing = await MeetupCategory.findOne({ name: cat.name });
      if (!existing) {
        await MeetupCategory.create({
          ...cat,
          displayName: cat.name,
          isActive: true,
          isFeatured: cat.order <= 4,
        });
        logger.info(`  Created Meetup Category: ${cat.icon} ${cat.name}`);
        created++;
      } else {
        await MeetupCategory.findByIdAndUpdate(existing._id, {
          icon: cat.icon,
          color: cat.color,
          order: cat.order,
          description: cat.description,
          displayName: existing.displayName || cat.name,
        });
        logger.info(`  Updated Meetup Category: ${cat.icon} ${cat.name}`);
        updated++;
      }
    }

    logger.info(`\n✅ Meetup Category seed complete. Created: ${created}, Updated: ${updated}`);
    process.exit(0);
  } catch (err) {
    logger.error(`Meetup Category seed failed: ${err.message}`);
    process.exit(1);
  }
}

seed();

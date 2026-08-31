const cron = require('node-cron');
const HotDeal = require('../models/HotDeal.model');
const { logger } = require('../utils/logger');

/**
 * HotDeals Auto-Scheduler
 *
 * Runs every 5 minutes to manage deal lifecycle transitions:
 * 1. scheduled → live   (when startDate <= now)
 * 2. live → expired     (when endDate < now OR claimedCount >= totalQuantity)
 * 3. Remove expired featured flag (featuredUntil < now)
 *
 * Uses node-cron, same pattern as buffet.scheduler.js
 */

async function runHotDealScheduler() {
  const now = new Date();

  try {
    // ── 1. Activate scheduled deals whose startDate has passed ──────────────
    const activationResult = await HotDeal.updateMany(
      {
        status: 'scheduled',
        startDate: { $lte: now },
        endDate: { $gt: now },
      },
      { $set: { status: 'live' } }
    );

    if (activationResult.modifiedCount > 0) {
      logger.info(`[HotDeals Scheduler] Activated ${activationResult.modifiedCount} deal(s) to LIVE`);
    }

    // ── 2. Expire live deals whose endDate has passed ────────────────────────
    const expiryResult = await HotDeal.updateMany(
      {
        status: 'live',
        endDate: { $lt: now },
      },
      { $set: { status: 'expired' } }
    );

    if (expiryResult.modifiedCount > 0) {
      logger.info(`[HotDeals Scheduler] Expired ${expiryResult.modifiedCount} deal(s) (end date passed)`);
    }

    // ── 3. Expire live limited deals that are fully claimed ──────────────────
    // We use aggregation to find deals where claimedCount >= totalQuantity
    const fullyClaimed = await HotDeal.find({
      status: 'live',
      availabilityType: 'limited',
      $expr: { $gte: ['$claimedCount', '$totalQuantity'] },
    }).select('_id');

    if (fullyClaimed.length > 0) {
      const ids = fullyClaimed.map((d) => d._id);
      await HotDeal.updateMany({ _id: { $in: ids } }, { $set: { status: 'expired' } });
      logger.info(`[HotDeals Scheduler] Expired ${fullyClaimed.length} fully-claimed deal(s)`);
    }

    // ── 4. Remove expired featured flags ────────────────────────────────────
    await HotDeal.updateMany(
      { isFeatured: true, featuredUntil: { $lt: now, $ne: null } },
      { $set: { isFeatured: false, featuredUntil: null } }
    );

  } catch (err) {
    logger.error(`[HotDeals Scheduler] Error: ${err.message}`);
  }
}

/**
 * Start the HotDeal auto-scheduler.
 * Called from server.js after DB connection is established.
 */
function startHotDealScheduler() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await runHotDealScheduler();
  });

  // Run immediately on startup to catch any missed transitions
  runHotDealScheduler();

  logger.info('[HotDeals Scheduler] Started — running every 5 minutes');
}

module.exports = { startHotDealScheduler };

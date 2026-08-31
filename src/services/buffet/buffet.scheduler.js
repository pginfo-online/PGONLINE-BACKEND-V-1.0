const cron = require('node-cron');
const Buffet = require('../../models/Buffet.model');
const BuffetReservation = require('../../models/BuffetReservation.model');

/**
 * buffet.scheduler.js — Automated lifecycle management for buffets.
 *
 * Scheduler jobs:
 *   1. Every 15 min: auto-transition approved/scheduled → live at startTime
 *   2. Every 15 min: auto-transition live → completed after expiresAt
 *   3. Every hour:   send BUFFET_STARTING_SOON to reserved users (1h before)
 *   4. Every Monday 8am: send BUFFET_WEEKLY_DIGEST to users
 */

let schedulersStarted = false;

/**
 * Parse 'HH:mm' time string and apply to a Date object.
 * Returns the modified date.
 */
const applyTime = (date, timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(date);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
};

/**
 * Job 1 & 2: Auto-live and auto-complete buffets.
 * Runs every 15 minutes.
 */
const runLifecycleTick = async () => {
  const now = new Date();

  try {
    // approved/scheduled → live (if buffet date+startTime has passed)
    // The Buffet.date field stores the full date. We match documents where:
    //   - status is approved or scheduled
    //   - date is on or before today
    // Then check startTime against current time in-memory
    // (startTime is a string, not a full Date, so we filter in application layer
    //  after a date-based pre-filter for performance)
    const candidatesForLive = await Buffet.find({
      status: { $in: ['approved', 'scheduled'] },
      date: { $lte: now },
      isActive: true,
    }).lean();

    const liveIds = [];
    for (const b of candidatesForLive) {
      const liveAt = applyTime(b.date, b.startTime);
      if (liveAt <= now) {
        liveIds.push(b._id);
      }
    }

    if (liveIds.length > 0) {
      await Buffet.updateMany(
        { _id: { $in: liveIds } },
        {
          $set: { status: 'live' },
          $push: {
            statusHistory: {
              status: 'live',
              changedBy: null,
              changedAt: now,
              reason: 'auto-live by scheduler',
            },
          },
        }
      );
      console.log(`[BuffetScheduler] ${liveIds.length} buffet(s) transitioned → live`);

      // Trigger BUFFET_LIVE notifications for newly live buffets
      try {
        const notificationTrigger = require('../notification/notification.trigger');
        for (const id of liveIds) {
          const buffet = await Buffet.findById(id).populate('hotel', 'name city area').lean();
          if (buffet && buffet.hotel) {
            await notificationTrigger.triggerBuffetLive(buffet);
          }
        }
      } catch (notifErr) {
        console.error('[BuffetScheduler] Notification error:', notifErr.message);
      }
    }

    // live → completed (expiresAt has passed)
    const completedResult = await Buffet.updateMany(
      { status: 'live', expiresAt: { $lt: now } },
      {
        $set: { status: 'completed', isActive: false },
        $push: {
          statusHistory: {
            status: 'completed',
            changedBy: null,
            changedAt: now,
            reason: 'auto-completed by scheduler',
          },
        },
      }
    );

    if (completedResult.modifiedCount > 0) {
      console.log(`[BuffetScheduler] ${completedResult.modifiedCount} buffet(s) transitioned → completed`);
    }

    // Mark no-show reservations for completed buffets
    await BuffetReservation.updateMany(
      {
        status: 'reserved',
        buffetDate: { $lt: now },
      },
      { $set: { status: 'no_show' } }
    );
  } catch (err) {
    console.error('[BuffetScheduler] Lifecycle tick error:', err.message);
  }
};

/**
 * Job 3: BUFFET_STARTING_SOON — notify reserved users 1h before buffet start.
 * Runs every hour at :00.
 */
const runStartingSoonJob = async () => {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const ninetyMinFromNow = new Date(now.getTime() + 90 * 60 * 1000);

  try {
    // Find live buffets starting in ~1h (between now+60min and now+90min window)
    const upcoming = await Buffet.find({
      status: 'live',
      date: {
        $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
        $lte: new Date(new Date().setUTCHours(23, 59, 59, 999)),
      },
    }).lean();

    const targetBuffetIds = [];
    for (const b of upcoming) {
      const startAt = applyTime(b.date, b.startTime);
      if (startAt >= oneHourFromNow && startAt <= ninetyMinFromNow) {
        targetBuffetIds.push(b._id);
      }
    }

    if (targetBuffetIds.length === 0) return;

    // Find all 'reserved' reservations for these buffets
    const reservations = await BuffetReservation.find({
      buffet: { $in: targetBuffetIds },
      status: 'reserved',
    })
      .populate('buffet', 'name hotel startTime')
      .populate('hotel', 'name')
      .lean();

    if (reservations.length === 0) return;

    // Group by buffet and send notifications
    try {
      const notificationTrigger = require('../notification/notification.trigger');
      for (const res of reservations) {
        await notificationTrigger.triggerBuffetStartingSoon(res);
      }
    } catch (notifErr) {
      console.error('[BuffetScheduler] StartingSoon notification error:', notifErr.message);
    }
  } catch (err) {
    console.error('[BuffetScheduler] StartingSoon job error:', err.message);
  }
};

/**
 * Start all buffet schedulers.
 * Should be called once from server.js after DB connection.
 */
const startBuffetSchedulers = () => {
  if (schedulersStarted) return;
  schedulersStarted = true;

  // Lifecycle: every 15 minutes
  cron.schedule('*/15 * * * *', runLifecycleTick);

  // Starting soon: every hour at :00
  cron.schedule('0 * * * *', runStartingSoonJob);

  console.log('[BuffetScheduler] ✅ Buffet lifecycle schedulers started');

  // Run immediately on startup
  runLifecycleTick();
};

module.exports = { startBuffetSchedulers, runLifecycleTick };

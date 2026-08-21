const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const ExportSchedule = require('../models/ExportSchedule.model');
const ExportJob = require('../models/ExportJob.model');
const excelService = require('./excel.service');
const { cloudinary } = require('../config/cloudinary');
const { logger } = require('../utils/logger');

/**
 * Executes a background scheduled export task
 * @param {Object} [options]
 * @param {string} [options.triggeredBy] - 'cron' | 'manual_test'
 * @param {Object} [options.user] - Optional User triggering manual test
 */
const executeScheduledExport = async (options = {}) => {
  const isManual = options.triggeredBy === 'manual_test';
  logger.info(`[ExportScheduler] Starting daily export task (Trigger: ${isManual ? 'Manual' : 'Cron 9:00 AM IST'})...`);

  const scheduleConfig = await ExportSchedule.getOrCreateSchedule();
  if (!scheduleConfig.isDaily9AMEnabled && !isManual) {
    logger.info('[ExportScheduler] Daily 9:00 AM export is disabled in settings. Skipping.');
    return null;
  }

  const dataset = scheduleConfig.dataset || 'pgs';
  const query = excelService.parseExportFilters({ dataset, ...(scheduleConfig.filters || {}) });

  // Update schedule status to running
  scheduleConfig.lastRunStatus = 'running';
  scheduleConfig.lastRunAt = new Date();
  await scheduleConfig.save();

  // Create tracking job in DB
  const job = await ExportJob.create({
    admin: options.user?._id || scheduleConfig.updatedBy || null,
    jobType: isManual ? 'manual_background' : 'daily_9am_schedule',
    dataset,
    status: 'processing',
    progress: 0,
    filters: scheduleConfig.filters || {},
  });

  const tempDir = path.join(__dirname, '../../uploads/exports');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `daily_export_${dataset}_${job._id}.xlsx`);

  try {
    const fileStream = fs.createWriteStream(tempFilePath);

    await new Promise((resolve, reject) => {
      fileStream.on('error', reject);
      excelService
        .generateExcelStream({
          dataset,
          query,
          writeStream: fileStream,
          onProgress: async (processed, total) => {
            if (total > 0) {
              const progress = Math.min(Math.round((processed / total) * 98), 98);
              await ExportJob.findByIdAndUpdate(job._id, { progress });
            }
          },
        })
        .then(resolve)
        .catch(reject);
    });

    // Upload Excel spreadsheet to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        tempFilePath,
        {
          resource_type: 'raw',
          folder: 'pginfo/exports/scheduled',
          public_id: `scheduled_export_${dataset}_${new Date().toISOString().slice(0, 10)}_${Date.now()}.xlsx`,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });

    const fileSize = fs.existsSync(tempFilePath) ? fs.statSync(tempFilePath).size : 0;

    // Mark job as completed
    await ExportJob.findByIdAndUpdate(job._id, {
      status: 'completed',
      progress: 100,
      fileUrl: uploadResult.secure_url,
      fileSize,
      completedAt: new Date(),
    });

    // Update schedule config state
    scheduleConfig.lastRunStatus = 'completed';
    scheduleConfig.lastJobId = job._id;
    scheduleConfig.lastRunError = null;
    await scheduleConfig.save();

    logger.info(`[ExportScheduler] ✓ Daily export completed successfully! File: ${uploadResult.secure_url}`);
    return { job, fileUrl: uploadResult.secure_url };
  } catch (err) {
    logger.error(`[ExportScheduler] ✗ Daily export failed: ${err.message}`);

    await ExportJob.findByIdAndUpdate(job._id, {
      status: 'failed',
      error: err.message || 'Scheduled export generation failed',
    });

    scheduleConfig.lastRunStatus = 'failed';
    scheduleConfig.lastRunError = err.message;
    await scheduleConfig.save();
    throw err;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        logger.warn(`[ExportScheduler] Temp file cleanup error: ${e.message}`);
      }
    }
  }
};

/**
 * Initializes cron schedule on server startup
 */
const startExportScheduler = () => {
  logger.info('[ExportScheduler] Initializing Daily 9:00 AM IST Auto-Export Cron...');

  // '0 9 * * *' = 9:00 AM every day
  cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        await executeScheduledExport({ triggeredBy: 'cron' });
      } catch (err) {
        logger.error(`[ExportScheduler] Cron execution exception: ${err.message}`);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  logger.info('[ExportScheduler] Daily 9:00 AM IST Auto-Export registered ✓');
};

module.exports = {
  startExportScheduler,
  executeScheduledExport,
};

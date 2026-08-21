const fs = require('fs');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const PG = require('../models/PG.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const RentRecord = require('../models/RentRecord.model');
const ExportJob = require('../models/ExportJob.model');
const ExportSchedule = require('../models/ExportSchedule.model');
const excelService = require('../services/excel.service');
const { executeScheduledExport } = require('../services/export.scheduler');
const { cloudinary } = require('../config/cloudinary');
const { logger } = require('../utils/logger');

/**
 * Runs the background export job: streams database rows into a temp file,
 * uploads to Cloudinary, updates progress, and cleans up temp files.
 */
const runBackgroundExport = async (jobId, dataset, query) => {
  await ExportJob.findByIdAndUpdate(jobId, { status: 'processing', progress: 0 });

  const tempDir = path.join(__dirname, '../../uploads/exports');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `export_${dataset}_${jobId}.xlsx`);

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
              await ExportJob.findByIdAndUpdate(jobId, { progress });
            }
          },
        })
        .then(resolve)
        .catch(reject);
    });

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        tempFilePath,
        {
          resource_type: 'raw',
          folder: 'pginfo/exports',
          public_id: `export_${dataset}_${jobId}_${Date.now()}.xlsx`,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });

    const fileSize = fs.existsSync(tempFilePath) ? fs.statSync(tempFilePath).size : 0;

    await ExportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      progress: 100,
      fileUrl: uploadResult.secure_url,
      fileSize,
      completedAt: new Date(),
    });

    logger.info(`Completed export job: ${jobId} (${dataset})`);
  } catch (err) {
    logger.error(`Error in runBackgroundExport for job ${jobId}: ${err.stack}`);
    await ExportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      error: err.message || 'Export generation failed',
    });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (unlinkErr) {
        logger.error(`Failed to delete temp file ${tempFilePath}: ${unlinkErr.message}`);
      }
    }
  }
};

/**
 * @route GET /api/v1/admin/pgs/export
 * @desc  Direct stream export file to browser
 */
const directExportPGs = asyncHandler(async (req, res) => {
  const dataset = req.query.dataset || 'pgs';
  const query = excelService.parseExportFilters(req.query);

  const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
  const filename = `${dataset}_export_${timestamp}.xlsx`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  try {
    await excelService.generateExcelStream({ dataset, query, writeStream: res });
  } catch (err) {
    logger.error(`Direct export failed: ${err.stack}`);
    if (!res.headersSent) {
      return errorResponse(res, 'Failed to generate Excel export file', 500);
    }
    res.end();
  }
});

/**
 * @route POST /api/v1/admin/pgs/export/job
 * @desc  Start an asynchronous background export job
 */
const initiateExportJob = asyncHandler(async (req, res) => {
  const dataset = req.body.dataset || 'pgs';
  const query = excelService.parseExportFilters(req.body);

  let totalDocs = 0;
  if (dataset === 'users') totalDocs = await User.countDocuments(query);
  else if (dataset === 'leads') totalDocs = await Lead.countDocuments(query);
  else if (dataset === 'rent') totalDocs = await RentRecord.countDocuments(query);
  else totalDocs = await PG.countDocuments(query);

  if (totalDocs === 0) {
    return errorResponse(res, `No records found in dataset '${dataset}' matching specified filters`, 400);
  }

  const job = await ExportJob.create({
    admin: req.user._id,
    jobType: 'manual_background',
    dataset,
    status: 'pending',
    progress: 0,
    filters: req.body,
  });

  setImmediate(() => {
    runBackgroundExport(job._id, dataset, query).catch((err) => {
      logger.error(`Export job runner crash for ${job._id}: ${err.message}`);
    });
  });

  return successResponse(res, 'Export job initiated successfully', { job }, 202);
});

/**
 * @route GET /api/v1/admin/pgs/export/jobs
 * @desc  Retrieve list of export jobs
 */
const getExportJobs = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 15, 50);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.dataset && req.query.dataset !== 'all') {
    filter.dataset = req.query.dataset;
  }
  if (req.query.jobType && req.query.jobType !== 'all') {
    filter.jobType = req.query.jobType;
  }

  const [jobs, total] = await Promise.all([
    ExportJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('admin', 'name email')
      .lean(),
    ExportJob.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  return paginatedResponse(res, 'Export jobs retrieved successfully', jobs, {
    total,
    page,
    limit,
    totalPages,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  });
});

/**
 * @route GET /api/v1/admin/pgs/export/jobs/:id
 */
const getExportJobStatus = asyncHandler(async (req, res) => {
  const job = await ExportJob.findById(req.params.id).populate('admin', 'name email');
  if (!job) {
    return res.status(404).json({ success: false, message: 'Export job not found' });
  }
  return successResponse(res, 'Export job status retrieved successfully', { job });
});

/**
 * @route DELETE /api/v1/admin/pgs/export/jobs/:id
 */
const deleteExportJob = asyncHandler(async (req, res) => {
  const job = await ExportJob.findByIdAndDelete(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Export job not found' });
  }
  return successResponse(res, 'Export job record deleted successfully');
});

/**
 * @route GET /api/v1/admin/pgs/export/schedule
 * @desc  Get the persistent 9:00 AM server-side schedule config & status
 */
const getExportScheduleConfig = asyncHandler(async (req, res) => {
  const schedule = await ExportSchedule.getOrCreateSchedule();

  // Compute next 9:00 AM IST execution timestamp
  const now = new Date();
  const nextRun = new Date(now);
  // Convert to IST offset (+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  const next9AM_IST = new Date(istNow);
  next9AM_IST.setUTCHours(3, 30, 0, 0); // 09:00 AM IST = 03:30 AM UTC

  if (now >= next9AM_IST) {
    next9AM_IST.setUTCDate(next9AM_IST.getUTCDate() + 1);
  }

  return successResponse(res, 'Export schedule retrieved successfully', {
    schedule: {
      ...schedule.toObject(),
      computedNextRunAt: next9AM_IST,
    },
  });
});

/**
 * @route PUT /api/v1/admin/pgs/export/schedule
 * @desc  Update schedule settings (enable/disable, dataset, default filters)
 */
const updateExportScheduleConfig = asyncHandler(async (req, res) => {
  const schedule = await ExportSchedule.getOrCreateSchedule();

  if (typeof req.body.isDaily9AMEnabled === 'boolean') {
    schedule.isDaily9AMEnabled = req.body.isDaily9AMEnabled;
  }
  if (req.body.dataset) {
    schedule.dataset = req.body.dataset;
  }
  if (req.body.filters) {
    schedule.filters = req.body.filters;
  }
  schedule.updatedBy = req.user._id;

  await schedule.save();
  return successResponse(res, 'Export schedule configuration updated successfully', { schedule });
});

/**
 * @route POST /api/v1/admin/pgs/export/schedule/trigger
 * @desc  Manually trigger the 9:00 AM scheduled export task immediately (test run)
 */
const triggerScheduledExportNow = asyncHandler(async (req, res) => {
  const result = await executeScheduledExport({
    triggeredBy: 'manual_test',
    user: req.user,
  });

  return successResponse(res, 'Scheduled export task executed successfully', result);
});

module.exports = {
  directExportPGs,
  initiateExportJob,
  getExportJobs,
  getExportJobStatus,
  deleteExportJob,
  getExportScheduleConfig,
  updateExportScheduleConfig,
  triggerScheduledExportNow,
};

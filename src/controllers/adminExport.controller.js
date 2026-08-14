const fs = require('fs');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const PG = require('../models/PG.model');
const ExportJob = require('../models/ExportJob.model');
const excelService = require('../services/excel.service');
const { cloudinary } = require('../config/cloudinary');
const { logger } = require('../utils/logger');

/**
 * Runs the background export job: streams database rows into a temp file,
 * uploads to Cloudinary, updates progress, and cleans up temp files.
 * @param {string} jobId - ExportJob ID in database
 * @param {Object} query - MongoDB query filter object
 */
const runBackgroundExport = async (jobId, query) => {
  // Update state to processing
  await ExportJob.findByIdAndUpdate(jobId, { status: 'processing', progress: 0 });

  // Create temporary exports folder under src/uploads/exports
  const tempDir = path.join(__dirname, '../../uploads/exports');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `pg_export_${jobId}.xlsx`);

  try {
    const total = await PG.countDocuments(query);
    let lastProgress = 0;

    // Progress updates throttled to avoid hitting MongoDB too heavily
    const onProgress = async (processed) => {
      if (total > 0) {
        const progress = Math.min(Math.round((processed / total) * 99), 99); // Max 99% until fully uploaded
        if (progress - lastProgress >= 5) {
          lastProgress = progress;
          await ExportJob.findByIdAndUpdate(jobId, { progress });
        }
      }
    };

    // Open file stream and generate the Excel document
    const fileStream = fs.createWriteStream(tempFilePath);
    
    // Wrap generatePGExcelStream inside a Promise to block until the stream is closed
    await new Promise((resolve, reject) => {
      fileStream.on('error', reject);
      excelService.generatePGExcelStream(fileStream, query, onProgress)
        .then(resolve)
        .catch(reject);
    });

    // Upload to Cloudinary using resource_type: 'raw' for non-media attachments
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        tempFilePath,
        {
          resource_type: 'raw',
          folder: 'pginfo/exports',
          public_id: `pg_export_${jobId}_${Date.now()}.xlsx`,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });

    const fileSize = fs.existsSync(tempFilePath) ? fs.statSync(tempFilePath).size : 0;

    // Mark job as completed
    await ExportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      progress: 100,
      fileUrl: uploadResult.secure_url,
      fileSize,
      completedAt: new Date(),
    });

    logger.info(`Successfully completed background export job: ${jobId}`);
  } catch (err) {
    logger.error(`Error in runBackgroundExport for job ${jobId}: ${err.stack}`);
    await ExportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      error: err.message || 'Unknown generation error',
    });
  } finally {
    // Safely delete local temporary file
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
 * @desc  Stream PG excel file directly to the client
 * @access Private (Admin only)
 */
const directExportPGs = asyncHandler(async (req, res) => {
  const query = excelService.parseExportFilters(req.query);

  const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
  const filename = `pg_listings_export_${timestamp}.xlsx`;

  // Set streaming headers
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  try {
    await excelService.generatePGExcelStream(res, query);
  } catch (err) {
    logger.error(`Direct export failed: ${err.stack}`);
    // If headers were not yet sent, send error response, otherwise end connection abruptly
    if (!res.headersSent) {
      return errorResponse(res, 'Failed to generate Excel export file', 500);
    }
    res.end();
  }
});

/**
 * @route POST /api/v1/admin/pgs/export/job
 * @desc  Initiate a background Excel export task
 * @access Private (Admin only)
 */
const initiateExportJob = asyncHandler(async (req, res) => {
  const query = excelService.parseExportFilters(req.body);

  // Check if there are any documents to export first to prevent empty jobs
  const totalDocs = await PG.countDocuments(query);
  if (totalDocs === 0) {
    return errorResponse(res, 'No PG listings found matching the specified filters', 400);
  }

  // Create pending export job tracking record
  const job = await ExportJob.create({
    admin: req.user._id,
    status: 'pending',
    progress: 0,
    filters: req.body,
  });

  // Run the job asynchronously without blocking HTTP response
  setImmediate(() => {
    runBackgroundExport(job._id, query).catch((err) => {
      logger.error(`Process runner crash for job ${job._id}: ${err.message}`);
    });
  });

  return successResponse(res, 'Export job initiated successfully', { job }, 202);
});

/**
 * @route GET /api/v1/admin/pgs/export/jobs
 * @desc  Retrieve list of background export jobs
 * @access Private (Admin only)
 */
const getExportJobs = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  const [jobs, total] = await Promise.all([
    ExportJob.find({ admin: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('admin', 'name email')
      .lean(),
    ExportJob.countDocuments({ admin: req.user._id }),
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
 * @desc  Get status details of a specific background export job
 * @access Private (Admin only)
 */
const getExportJobStatus = asyncHandler(async (req, res) => {
  const job = await ExportJob.findOne({
    _id: req.params.id,
    admin: req.user._id,
  }).populate('admin', 'name email');

  if (!job) {
    return res.status(404).json({ success: false, message: 'Export job not found' });
  }

  return successResponse(res, 'Export job status retrieved successfully', { job });
});

/**
 * @route DELETE /api/v1/admin/pgs/export/jobs/:id
 * @desc  Delete an export job record
 * @access Private (Admin only)
 */
const deleteExportJob = asyncHandler(async (req, res) => {
  const job = await ExportJob.findOneAndDelete({
    _id: req.params.id,
    admin: req.user._id,
  });

  if (!job) {
    return res.status(404).json({ success: false, message: 'Export job not found' });
  }

  return successResponse(res, 'Export job record deleted successfully');
});

module.exports = {
  directExportPGs,
  initiateExportJob,
  getExportJobs,
  getExportJobStatus,
  deleteExportJob,
};

const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const JobPost        = require('../../models/JobPost.model');
const JobApplication = require('../../models/JobApplication.model');
const PG             = require('../../models/PG.model');
const notificationTrigger = require('../../services/notification/notification.trigger');

// ─── Create Job Post (Owner) ──────────────────────────────────────────────────
exports.createJobPost = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const jobPost = await JobPost.create({
    pg: pgId,
    owner: ownerId,
    city: pg.city,
    area: pg.area,
    address: pg.address,
    ...req.body,
  });

  notificationTrigger.onJobPosted({ ...jobPost.toObject(), pg }).catch(() => {});
  return successResponse(res, 'Job post created successfully', jobPost, 201);
});

// ─── Get Owner's Job Posts ────────────────────────────────────────────────────
exports.getMyJobPosts = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const jobs = await JobPost.find({ pg: pgId, owner: ownerId }).sort({ createdAt: -1 });
  return successResponse(res, 'Job posts fetched', jobs);
});

// ─── Update Job Post ──────────────────────────────────────────────────────────
exports.updateJobPost = asyncHandler(async (req, res) => {
  const job = await JobPost.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) return errorResponse(res, 'Job post not found or access denied', 404);

  const ALLOWED = [
    'title', 'role', 'customRole', 'description', 'requirements',
    'salaryMin', 'salaryMax', 'salaryFrequency', 'genderPreference',
    'experienceRequired', 'accommodation', 'food', 'workingHours',
    'shiftType', 'status', 'bannerImage',
  ];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) job[key] = req.body[key]; });

  if (req.body.status === 'closed' || req.body.status === 'filled') {
    job.closedAt = new Date();
  }

  await job.save();
  return successResponse(res, 'Job post updated', job);
});

// ─── Get Applications for a Job Post ─────────────────────────────────────────
exports.getJobApplications = asyncHandler(async (req, res) => {
  const job = await JobPost.findOne({ _id: req.params.jobId, owner: req.user._id });
  if (!job) return errorResponse(res, 'Job post not found or access denied', 404);

  const applications = await JobApplication.find({ jobPost: job._id }).sort({ createdAt: -1 });
  return successResponse(res, 'Applications fetched', applications);
});

// ─── Update Application Status (Shortlist, Hire, Reject) ──────────────────────
exports.updateApplicationStatus = asyncHandler(async (req, res) => {
  const application = await JobApplication.findOne({ _id: req.params.id, owner: req.user._id });
  if (!application) return errorResponse(res, 'Application not found or access denied', 404);

  const { status, ownerNotes, rejectionReason, interviewDate } = req.body;
  if (status) application.status = status;
  if (ownerNotes) application.ownerNotes = ownerNotes;
  if (rejectionReason) application.rejectionReason = rejectionReason;
  if (interviewDate) application.interviewDate = interviewDate;

  if (status === 'hired' && !application.hiredAt) {
    application.hiredAt = new Date();
  }

  await application.save();
  notificationTrigger.onJobApplicationStatusUpdated(application, { _id: application.jobPost }).catch(() => {});
  return successResponse(res, `Application status updated to ${status}`, application);
});

// ─── Public: Browse Open Jobs (Mobile Hiring Tab) ─────────────────────────────
exports.getPublicJobs = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = { status: 'open' };
  if (req.query.role) filter.role = req.query.role;
  if (req.query.city) filter.city = new RegExp(req.query.city, 'i');

  const [jobs, total] = await Promise.all([
    JobPost.find(filter)
      .populate('pg', 'name city area photos')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    JobPost.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Open jobs fetched', jobs, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

// ─── Public: Get Single Job Details ───────────────────────────────────────────
exports.getPublicJobDetails = asyncHandler(async (req, res) => {
  const job = await JobPost.findById(req.params.id).populate('pg', 'name city area address contactPhone photos');
  if (!job || job.status !== 'open') {
    return errorResponse(res, 'Job post not found or no longer active', 404);
  }

  // Increment view counter
  job.views += 1;
  await job.save();

  return successResponse(res, 'Job details fetched', job);
});

// ─── Public / User: Apply for Job ─────────────────────────────────────────────
exports.applyForJob = asyncHandler(async (req, res) => {
  const job = await JobPost.findById(req.params.id);
  if (!job || job.status !== 'open') {
    return errorResponse(res, 'Job post not found or closed', 404);
  }

  const { applicantName, phone, email, experience, coverLetter, currentLocation } = req.body;

  // Check duplicate application by phone
  const existing = await JobApplication.findOne({ jobPost: job._id, phone });
  if (existing) {
    return errorResponse(res, 'You have already applied for this position with this phone number', 409);
  }

  const application = await JobApplication.create({
    jobPost:         job._id,
    pg:              job.pg,
    owner:           job.owner,
    applicantUser:   req.user ? req.user._id : null,
    applicantName,
    phone,
    email,
    experience:      experience || 0,
    coverLetter,
    currentLocation,
  });

  // Increment application counter on job
  job.applications += 1;
  await job.save();

  notificationTrigger.onJobApplicationReceived(
    application,
    { ...job.toObject(), owner: job.owner }
  ).catch(() => {});
  return successResponse(res, 'Application submitted successfully', application, 201);
});

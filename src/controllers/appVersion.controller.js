const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/apiResponse');
const AppVersion = require('../models/AppVersion.model');
const AppVersionAudit = require('../models/AppVersionAudit.model');

// Semver comparison helpers
const parseSemver = (v) => {
  const clean = (v || '').replace(/[^0-9.]/g, '');
  const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
};

const compareSemver = (v1, v2) => {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  return p1.patch - p2.patch;
};

// Device hash helper for rollout group (0-99)
const getRolloutGroup = (deviceId) => {
  if (!deviceId) return 100;
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash << 5) - hash + deviceId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
};

/**
 * Public check app version
 * @route GET /api/v1/app-version/check
 */
const checkAppVersion = asyncHandler(async (req, res) => {
  const { platform, version, deviceId } = req.query;

  // Retrieve active versions, sorted from newest to oldest
  const activeVersions = await AppVersion.find({
    platform,
    isActive: true,
    $or: [
      { scheduledRelease: null },
      { scheduledRelease: { $lte: new Date() } }
    ]
  }).sort({ createdAt: -1 }).lean();

  if (activeVersions.length === 0) {
    return successResponse(res, 'No version configuration found', {
      updateRequired: false,
      maintenanceMode: false,
    });
  }

  // Find the highest version applicable to this device based on percentage rollout
  let targetVersion = null;
  const clientRolloutGroup = getRolloutGroup(deviceId);

  for (const vConfig of activeVersions) {
    if (vConfig.rolloutPercentage >= 100 || clientRolloutGroup < vConfig.rolloutPercentage) {
      targetVersion = vConfig;
      break;
    }
  }

  if (!targetVersion) {
    // If user doesn't fall into any rolling out version, use the oldest active version as fallback
    targetVersion = activeVersions[activeVersions.length - 1];
  }

  // Check Maintenance Mode
  if (targetVersion.maintenanceMode) {
    return successResponse(res, 'App is currently in maintenance mode', {
      updateRequired: false,
      maintenanceMode: true,
      maintenanceMessage: targetVersion.maintenanceMessage,
    });
  }

  const comparison = compareSemver(version, targetVersion.version);
  const minVersionComparison = compareSemver(version, targetVersion.minVersion);

  // If client version is equal or higher than target version, no update required
  if (comparison >= 0) {
    return successResponse(res, 'App is up to date', {
      updateRequired: false,
      maintenanceMode: false,
      currentLatest: targetVersion.version,
    });
  }

  // Determine update priority/type
  let updateType = targetVersion.priority;
  // If client version is below the minimum supported version, force Critical update
  if (minVersionComparison < 0) {
    updateType = 'critical';
  }

  successResponse(res, 'Update status retrieved', {
    updateRequired: true,
    updateType, // 'optional' | 'recommended' | 'important' | 'critical'
    title: targetVersion.title,
    description: targetVersion.description,
    updateLink: targetVersion.updateLink,
    releaseNotes: targetVersion.releaseNotes,
    maintenanceMode: false,
    currentLatest: targetVersion.version,
  });
});

/**
 * Public get latest version raw details
 * @route GET /api/v1/app-version/latest
 */
const getLatestVersionRaw = asyncHandler(async (req, res) => {
  const { platform } = req.query;
  const latest = await AppVersion.findOne({ platform, isActive: true }).sort({ createdAt: -1 });
  if (!latest) {
    return res.status(404).json({ success: false, message: 'No active version config found' });
  }
  successResponse(res, 'Latest version retrieved', { latest });
});

// Admin Controllers

/**
 * Create new version config
 * @route POST /api/v1/app-version
 */
const createVersion = asyncHandler(async (req, res) => {
  const versionData = { ...req.body, createdBy: req.user._id, updatedBy: req.user._id };
  const newVersion = await AppVersion.create(versionData);

  // Audit Log
  await AppVersionAudit.create({
    versionId: newVersion._id,
    action: 'create',
    performedBy: req.user._id,
    changes: newVersion.toObject(),
  });

  successResponse(res, 'Version configuration created successfully', { version: newVersion }, 201);
});

/**
 * Update version config
 * @route PUT /api/v1/app-version/:id
 */
const updateVersion = asyncHandler(async (req, res) => {
  const originalVersion = await AppVersion.findById(req.params.id);
  if (!originalVersion) {
    return res.status(404).json({ success: false, message: 'Version config not found' });
  }

  const updatedVersion = await AppVersion.findByIdAndUpdate(
    req.params.id,
    { ...req.body, updatedBy: req.user._id },
    { new: true, runValidators: true }
  );

  // Compute changes for audit log
  const changes = {};
  for (const key of Object.keys(req.body)) {
    if (JSON.stringify(originalVersion[key]) !== JSON.stringify(updatedVersion[key])) {
      changes[key] = {
        old: originalVersion[key],
        new: updatedVersion[key],
      };
    }
  }

  // Audit Log
  await AppVersionAudit.create({
    versionId: updatedVersion._id,
    action: 'update',
    performedBy: req.user._id,
    changes,
  });

  successResponse(res, 'Version configuration updated successfully', { version: updatedVersion });
});

/**
 * Delete version config
 * @route DELETE /api/v1/app-version/:id
 */
const deleteVersion = asyncHandler(async (req, res) => {
  const version = await AppVersion.findById(req.params.id);
  if (!version) {
    return res.status(404).json({ success: false, message: 'Version config not found' });
  }

  await AppVersion.findByIdAndDelete(req.params.id);

  // Audit Log
  await AppVersionAudit.create({
    versionId: version._id,
    action: 'delete',
    performedBy: req.user._id,
    changes: { deletedVersion: version.version, platform: version.platform },
  });

  successResponse(res, 'Version configuration deleted successfully');
});

/**
 * Get all versions (for admin dashboard list)
 * @route GET /api/v1/app-version/admin/all
 */
const getAllVersionsAdmin = asyncHandler(async (req, res) => {
  const versions = await AppVersion.find()
    .sort({ platform: 1, createdAt: -1 })
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .lean();

  successResponse(res, 'All version configurations retrieved', { versions });
});

/**
 * Get audit logs (for admin analytics/history)
 * @route GET /api/v1/app-version/admin/audits
 */
const getVersionAudits = asyncHandler(async (req, res) => {
  const audits = await AppVersionAudit.find()
    .sort({ createdAt: -1 })
    .populate('performedBy', 'name email')
    .populate('versionId', 'version platform')
    .lean();

  successResponse(res, 'Version audit logs retrieved', { audits });
});

module.exports = {
  checkAppVersion,
  getLatestVersionRaw,
  createVersion,
  updateVersion,
  deleteVersion,
  getAllVersionsAdmin,
  getVersionAudits,
};

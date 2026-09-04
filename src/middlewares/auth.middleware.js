const jwt = require('jsonwebtoken');
const { errorResponse } = require('../utils/apiResponse');
const User = require('../models/User.model');
const asyncHandler = require('../utils/asyncHandler');
const { hasCapability } = require('../utils/capabilities');

/**
 * Verify JWT and attach user to request
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return errorResponse(res, 'Not authorized, no token provided', 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return errorResponse(res, 'User not found', 401);
    }

    if (!user.isActive) {
      return errorResponse(res, 'Account has been suspended', 403);
    }

    // Ensure roles array and role string are fully normalized and auto-healed
    if (typeof user.toSafeObject === 'function') {
      const safe = user.toSafeObject();
      user.roles = safe.roles;
      user.role = safe.role;
      user.isHotelOwner = safe.isHotelOwner;
    }

    req.user = user;
    next();
  } catch (error) {
    return errorResponse(res, 'Invalid or expired token', 401);
  }
});

/**
 * Role-based access control middleware factory (multi-role aware)
 * @param {...string} roles - Allowed roles (any match grants access)
 */
const authorize = (...roles) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Not authenticated', 401);
    }

    const userRoles = req.user.roles || [req.user.role];

    // Check if user has ANY of the required roles
    const hasAccess = roles.some((r) => userRoles.includes(r));

    if (!hasAccess) {
      return errorResponse(
        res,
        `Access denied. Required role(s): ${roles.join(', ')}`,
        403
      );
    }
    next();
  });
};

/**
 * Optional auth -- attaches user if token present, but doesn't require it
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (user) {
        if (!user.roles || user.roles.length === 0) {
          user.roles = [user.role || 'tenant'];
        }
        if (user.isHotelOwner && !user.roles.includes('hotel_owner')) {
          user.roles.push('hotel_owner');
        }
        req.user = user;
      }
    } catch (_) {
      // silently ignore invalid tokens for optional auth
    }
  }
  next();
});

/**
 * Hotel Owner Guard -- requires hotel_owner role OR admin.
 * Multi-role aware: checks the roles array, not just the single role field.
 */
const requireHotelOwner = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    return errorResponse(res, 'Not authenticated', 401);
  }

  const userRoles = req.user.roles || [req.user.role];
  const isAdmin = userRoles.includes('admin');
  const isHotelOwner = userRoles.includes('hotel_owner') || req.user.isHotelOwner === true;

  if (isAdmin || isHotelOwner) {
    return next();
  }
  return errorResponse(res, 'Hotel owner access required. Please register as a hotel partner first.', 403);
});

/**
 * Utility: check if a user document has a specific role
 */
const userHasRole = (user, role) => {
  const roles = user?.roles || [user?.role];
  return roles.includes(role);
};

/**
 * Capability-based access control middleware factory.
 *
 * More granular than role checks — checks derived capabilities which
 * are computed from roles[] but expressed as intent-based strings.
 *
 * Example:
 *   router.delete('/pgs/:id', protect, requireCapability('can_manage_pgs'), deletePG);
 *
 * @param {...string} caps - Required capability strings (ANY match grants access)
 */
const requireCapability = (...caps) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Not authenticated', 401);
    }

    const hasAccess = caps.some((cap) => hasCapability(req.user, cap));

    if (!hasAccess) {
      return errorResponse(
        res,
        `Access denied. Required capability: ${caps.join(' or ')}`,
        403
      );
    }
    next();
  });

/**
 * Resource ownership middleware factory.
 *
 * Verifies the authenticated user owns a specific resource before
 * allowing the operation. Admin users bypass this check.
 *
 * Example:
 *   router.put('/pgs/:id', protect, requireOwnership('PG', 'id'), updatePG);
 *
 * @param {string} modelName  - The Mongoose model name (e.g. 'PG', 'Hotel')
 * @param {string} paramName  - The route param name for the resource ID (e.g. 'id')
 */
const requireOwnership = (modelName, paramName = 'id') =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Not authenticated', 401);
    }

    // Admins bypass ownership checks
    const userRoles = req.user.roles || [req.user.role];
    if (userRoles.includes('admin')) {
      return next();
    }

    const resourceId = req.params[paramName];
    if (!resourceId) {
      return errorResponse(res, `Resource ID param '${paramName}' not found in route`, 400);
    }

    try {
      const Model = require(`../models/${modelName}.model`);
      const resource = await Model.findById(resourceId).select('owner').lean();

      if (!resource) {
        return errorResponse(res, `${modelName} not found`, 404);
      }

      const ownerId = resource.owner?.toString?.() || resource.owner;
      const userId = req.user._id?.toString?.() || req.user._id;

      if (ownerId !== userId) {
        return errorResponse(
          res,
          `You do not have permission to modify this ${modelName}`,
          403
        );
      }

      next();
    } catch (err) {
      return errorResponse(res, `Ownership check failed: ${err.message}`, 500);
    }
  });

module.exports = {
  protect,
  authorize,
  optionalAuth,
  requireHotelOwner,
  userHasRole,
  requireCapability,
  requireOwnership,
};

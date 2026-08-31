const jwt = require('jsonwebtoken');
const { errorResponse } = require('../utils/apiResponse');
const User = require('../models/User.model');
const asyncHandler = require('../utils/asyncHandler');

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

module.exports = { protect, authorize, optionalAuth, requireHotelOwner, userHasRole };

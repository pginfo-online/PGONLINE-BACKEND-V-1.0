const { logger } = require('../utils/logger');

/**
 * Centralized Express error handler
 * Must be registered AFTER all routes
 */
const errorMiddleware = (err, req, res, next) => {
  try {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // Mongoose validation error
    if (err.name === 'ValidationError' && err.errors) {
      statusCode = 400;
      const errors = Object.values(err.errors).map((e) => e.message);
      message = errors.join(', ');
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
      statusCode = 409;
      const field = err.keyValue ? Object.keys(err.keyValue)[0] : 'record';
      message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    }

    // Mongoose cast error (invalid ObjectId)
    if (err.name === 'CastError') {
      statusCode = 400;
      message = `Invalid value for field: ${err.path}`;
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
      statusCode = 401;
      message = 'Invalid authentication token';
    }

    if (err.name === 'TokenExpiredError') {
      statusCode = 401;
      message = 'Authentication token has expired. Please log in again.';
    }

    // Multer file size error
    if (err.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      message = 'File size too large (max 10MB)';
    }

    logger.error(`${req.method} ${req.originalUrl} → ${statusCode}: ${message}`);

    // Explicitly append CORS headers on error responses
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    return res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  } catch (internalErr) {
    logger.error(`Error inside errorMiddleware: ${internalErr.message}`);
    return res.status(500).json({
      success: false,
      message: 'An internal server error occurred',
    });
  }
};

module.exports = errorMiddleware;

const mongoose = require('mongoose');
const dns = require('dns');
const { logger } = require('../utils/logger');

// In development or when explicitly enabled, configure fallback DNS for mongodb+srv:// resolution.
// In production on AWS VPC, this remains OFF by default to preserve Route 53 VPC resolver functionality.
const shouldUseFallbackDns =
  process.env.USE_FALLBACK_DNS === 'true' ||
  (process.env.NODE_ENV !== 'production' &&
    process.env.USE_FALLBACK_DNS !== 'false' &&
    (process.env.MONGODB_URI || '').startsWith('mongodb+srv://'));

if (shouldUseFallbackDns) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    logger.info('ℹ️ Public DNS servers configured for mongodb+srv resolution (8.8.8.8, 1.1.1.1)');
  } catch (dnsErr) {
    logger.warn(`⚠️ Failed to set fallback DNS servers: ${dnsErr.message}`);
  }
}

const MAX_RETRIES = parseInt(process.env.MONGO_CONNECT_MAX_RETRIES, 10) || 5;
const RETRY_INTERVAL_MS = 2000;

/**
 * Connect to MongoDB with production connection pooling, timeouts, and startup retries.
 */
const connectDB = async () => {
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    logger.error('❌ MONGODB_URI environment variable is not set');
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const mongooseOptions = {
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 25,
    minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 5,
    serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10) || 5000,
    socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 10) || 45000,
    heartbeatFrequencyMS: 10000,
    autoIndex: process.env.NODE_ENV !== 'production', // Disable auto-index creation in production for performance
  };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      attempt++;
      const conn = await mongoose.connect(dbUri, mongooseOptions);
      logger.info(`✅ MongoDB connected: ${conn.connection.host} [Pool: ${mongooseOptions.minPoolSize}-${mongooseOptions.maxPoolSize}]`);
      return conn;
    } catch (error) {
      logger.error(`❌ MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      const backoff = RETRY_INTERVAL_MS * Math.pow(1.5, attempt - 1);
      logger.warn(`⏳ Retrying MongoDB connection in ${Math.round(backoff)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
};

/**
 * Gracefully disconnect from MongoDB (used during SIGTERM / SIGINT shutdown)
 */
const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      logger.info('MongoDB connection closed gracefully');
    }
  } catch (err) {
    logger.error(`Error closing MongoDB connection: ${err.message}`);
  }
};

// Lifecycle event listeners
mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected. Mongoose driver will attempt reconnect...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('✅ MongoDB reconnected successfully');
});

mongoose.connection.on('error', (err) => {
  logger.error(`❌ MongoDB runtime error: ${err.message}`);
});

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;


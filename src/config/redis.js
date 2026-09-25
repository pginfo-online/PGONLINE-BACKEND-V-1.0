const Redis = require('ioredis');
const { logger } = require('../utils/logger');

/**
 * Redis Configuration
 *
 * Production-grade Redis connection with:
 * - Lazy initialization (connects on first use)
 * - Automatic reconnection with exponential backoff
 * - Health check logging
 * - Graceful shutdown support
 *
 * Environment variables:
 *   REDIS_URL          — Full Redis connection URL (redis://host:port)
 *   REDIS_HOST         — Redis host (fallback: 127.0.0.1)
 *   REDIS_PORT         — Redis port (fallback: 6379)
 *   REDIS_PASSWORD     — Redis password (optional)
 *   REDIS_DB           — Redis database number (fallback: 0)
 *   REDIS_KEY_PREFIX   — Key prefix for namespacing (fallback: pginfo:)
 */

let redisConnection = null;

const REDIS_CONFIG = {
  host:     process.env.REDIS_HOST || '127.0.0.1',
  port:     parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db:       parseInt(process.env.REDIS_DB, 10) || 0,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  retryStrategy: (times) => {
    if (times > 20) {
      logger.error(`[Redis] Max reconnection attempts (20) reached. Giving up.`);
      return null; // Stop retrying
    }
    const delay = Math.min(times * 200, 5000); // Exponential backoff, max 5s
    logger.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
    return targetErrors.some((e) => err.message.includes(e));
  },
};

/**
 * Get or create the shared Redis connection instance.
 * Uses REDIS_URL if provided, otherwise falls back to individual config vars.
 */
const getRedisConnection = () => {
  if (redisConnection) return redisConnection;

  if (process.env.REDIS_URL) {
    redisConnection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: REDIS_CONFIG.retryStrategy,
      reconnectOnError: REDIS_CONFIG.reconnectOnError,
    });
  } else {
    redisConnection = new Redis(REDIS_CONFIG);
  }

  redisConnection.on('connect', () => {
    logger.info('✅ Redis connected');
  });

  redisConnection.on('ready', () => {
    logger.info('✅ Redis ready to accept commands');
  });

  redisConnection.on('error', (err) => {
    logger.error(`❌ Redis error: ${err.message}`);
  });

  redisConnection.on('close', () => {
    logger.warn('⚠️ Redis connection closed');
  });

  return redisConnection;
};

/**
 * Create a new Redis connection for BullMQ workers.
 * BullMQ requires separate connections for workers (blocking operations).
 */
const createWorkerConnection = () => {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return new Redis(REDIS_CONFIG);
};

/**
 * Gracefully disconnect Redis on shutdown.
 */
const disconnectRedis = async () => {
  if (redisConnection) {
    try {
      await redisConnection.quit();
      logger.info('👋 Redis disconnected gracefully');
    } catch (err) {
      logger.error(`❌ Redis disconnect error: ${err.message}`);
      redisConnection.disconnect();
    }
    redisConnection = null;
  }
};

/**
 * Redis health check.
 */
const isRedisHealthy = async () => {
  try {
    const conn = getRedisConnection();
    const result = await conn.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
};

module.exports = {
  getRedisConnection,
  createWorkerConnection,
  disconnectRedis,
  isRedisHealthy,
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || 'pginfo:',
};

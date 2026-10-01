const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redisConnection = null;
const workerClients = new Set();

// Throttle logging to prevent console/log file spamming during outages
const logThrottle = {
  lastErrorLog: 0,
  lastWorkerErrorLog: 0,
  lastRetryLog: 0,
  lastReconnectingLog: 0,
};

/**
 * Sanitize connection URL for secure logging (mask password and user info)
 * @param {string} url
 * @returns {string}
 */
const sanitizeRedisUrl = (url) => {
  if (!url) return '[empty]';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '******';
    if (parsed.username && parsed.username !== 'default') parsed.username = '******';
    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
};

/**
 * Sanitize error message to prevent leaking credentials
 * @param {string} msg
 * @returns {string}
 */
const sanitizeErrorMessage = (msg) => {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(/rediss?:\/\/[^@]+@/gi, 'rediss://***:***@')
    .replace(/(?:password|token|secret)[:=]\s*([^\s&]+)/gi, '$1=******');
};

const getRedisUrl = () => (process.env.REDIS_URL ? process.env.REDIS_URL.trim() : '');
const getRedisDb = () => Number(process.env.REDIS_DB !== undefined ? process.env.REDIS_DB : 0);
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'pgm:';

/**
 * Parse connection URL components safely
 * @returns {object|null}
 */
const parseRedisConfig = () => {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  try {
    const parsed = new URL(redisUrl);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: Number(parsed.port) || 6379,
      username: parsed.username || 'default',
      password: decodeURIComponent(parsed.password || ''),
      isTls: parsed.protocol === 'rediss:',
      db: getRedisDb(),
    };
  } catch (err) {
    logger.error(`[Redis] Failed to parse REDIS_URL: ${sanitizeErrorMessage(err.message)}`);
    return null;
  }
};

/**
 * Validate Redis configuration against production requirements
 * @throws {Error} in production if configuration is missing or insecure
 * @returns {boolean}
 */
const validateRedisConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    const msg = '[Redis] Missing REDIS_URL environment variable. Upstash rediss:// URL is required.';
    if (isProduction) {
      logger.error(`❌ ${msg}`);
      throw new Error(msg);
    } else {
      logger.warn(`⚠️ ${msg} Caching and background workers will operate in offline/degraded mode.`);
      return false;
    }
  }

  let parsed;
  try {
    parsed = new URL(redisUrl);
  } catch (err) {
    const msg = `[Redis] Invalid REDIS_URL format: ${err.message}`;
    if (isProduction) {
      logger.error(`❌ ${msg}`);
      throw new Error(msg);
    }
    logger.warn(`⚠️ ${msg}`);
    return false;
  }

  // Ensure TLS is used (rediss://)
  if (parsed.protocol !== 'rediss:') {
    const msg = `[Redis] Insecure protocol "${parsed.protocol}" in REDIS_URL. Upstash requires TLS ("rediss://").`;
    if (isProduction) {
      logger.error(`❌ ${msg}`);
      throw new Error(msg);
    }
    logger.warn(`⚠️ ${msg}`);
  }

  // Reject localhost / 127.0.0.1 in production
  if (isProduction && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    const msg = '[Redis] Localhost / 127.0.0.1 is not permitted for REDIS_URL in production environment.';
    logger.error(`❌ ${msg}`);
    throw new Error(msg);
  }

  return true;
};

/**
 * Build production-grade ioredis options for Upstash
 * @param {object} customOptions
 * @returns {object}
 */
const createClientOptions = (customOptions = {}) => {
  const parsed = parseRedisConfig();
  const hostname = parsed?.hostname;

  return {
    // Upstash TLS settings with Server Name Indication (SNI)
    tls: (parsed?.isTls || !parsed)
      ? {
          servername: hostname,
          rejectUnauthorized: true,
        }
      : undefined,

    db: getRedisDb(),
    connectTimeout: 10000,
    keepAlive: 10000,
    lazyConnect: true,
    enableReadyCheck: true,
    // maxRetriesPerRequest: null is required for BullMQ compatibility
    maxRetriesPerRequest: null,

    // Returning null tells ioredis to NOT retry on connection failure.
    // Commented-out = ioredis uses its default (infinite retries), which is NOT what we want.
    retryStrategy: () => null,


    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
      return targetErrors.some((error) => (err?.message || '').includes(error));
    },

    ...customOptions,
  };
};

/**
 * Attach lifecycle event listeners to an ioredis client
 * @param {Redis} client
 * @param {string} label
 */
const attachEventHandlers = (client, label = 'Redis') => {
  client.on('connect', () => {
    logger.info(`✅ [${label}] TCP/TLS connection established`);
  });

  client.on('ready', () => {
    logger.info(`✅ [${label}] Ready to accept commands`);
  });

  client.on('reconnecting', (delay) => {
    const now = Date.now();
    if (!logThrottle.lastReconnectingLog || now - logThrottle.lastReconnectingLog > 20000) {
      logThrottle.lastReconnectingLog = now;
      logger.warn(`⚠️ [${label}] Reconnecting in ${delay}ms...`);
    }
  });

  client.on('error', (err) => {
    const sanitized = sanitizeErrorMessage(err?.message || 'Unknown error');
    const now = Date.now();
    if (!logThrottle.lastErrorLog || now - logThrottle.lastErrorLog > 20000) {
      logThrottle.lastErrorLog = now;
      logger.error(`[${label}] ${sanitized}`);
    }
  });

  client.on('close', () => {
    logger.warn(`⚠️ [${label}] Connection closed`);
  });

  client.on('end', () => {
    logger.warn(`⚠️ [${label}] Connection ended`);
  });
};

/**
 * Get or initialize the singleton Redis client
 * @returns {Redis|null}
 */
const getRedisConnection = () => {
  if (redisConnection) {
    return redisConnection;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Redis] REDIS_URL is required in production environment.');
    }
    return null;
  }

  const options = createClientOptions();
  redisConnection = new Redis(redisUrl, options);

  attachEventHandlers(redisConnection, 'Redis');

  if (options.lazyConnect && redisConnection.status === 'wait') {
    redisConnection.connect().catch((err) => {
      const sanitized = sanitizeErrorMessage(err?.message);
      logger.warn(`⚠️ [Redis] Background connection attempt: ${sanitized}`);
    });
  }

  return redisConnection;
};

/**
 * Create a dedicated connection for BullMQ workers
 * @returns {Redis|null}
 */
const createWorkerConnection = () => {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Redis] REDIS_URL is required for worker connections in production.');
    }
    return null;
  }

  const options = createClientOptions();
  const workerClient = new Redis(redisUrl, options);

  // Attach silent error handler on worker client to prevent Node unhandled error crash
  workerClient.on('error', (err) => {
    const sanitized = sanitizeErrorMessage(err?.message);
    const now = Date.now();
    if (!logThrottle.lastWorkerErrorLog || now - logThrottle.lastWorkerErrorLog > 20000) {
      logThrottle.lastWorkerErrorLog = now;
      logger.warn(`[Redis Worker] ${sanitized}`);
    }
  });

  if (options.lazyConnect && workerClient.status === 'wait') {
    workerClient.connect().catch(() => {});
  }

  workerClients.add(workerClient);
  return workerClient;
};

/**
 * Gracefully disconnect singleton Redis and all worker connections
 * @param {number} timeoutMs
 */
const disconnectRedis = async (timeoutMs = 3000) => {
  const closeTasks = [];

  for (const workerClient of workerClients) {
    if (workerClient && workerClient.status !== 'end') {
      const client = workerClient;
      closeTasks.push(
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { client.disconnect(); } catch (_) {}
            resolve();
          }, timeoutMs);

          client
            .quit()
            .catch(() => {
              try { client.disconnect(); } catch (_) {}
            })
            .finally(() => {
              clearTimeout(timer);
              resolve();
            });
        })
      );
    }
  }
  workerClients.clear();

  if (redisConnection && redisConnection.status !== 'end') {
    const client = redisConnection;
    closeTasks.push(
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { client.disconnect(); } catch (_) {}
          resolve();
        }, timeoutMs);

        client
          .quit()
          .catch(() => {
            try { client.disconnect(); } catch (_) {}
          })
          .finally(() => {
            clearTimeout(timer);
            resolve();
          });
      })
    );
  }

  try {
    await Promise.allSettled(closeTasks);
    logger.info('👋 Redis disconnected gracefully');
  } catch (err) {
    logger.error(`❌ Redis disconnect error: ${sanitizeErrorMessage(err.message)}`);
  } finally {
    redisConnection = null;
  }
};

/**
 * Fast health check via PING -> PONG
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
const isRedisHealthy = async (timeoutMs = 3000) => {
  try {
    const redis = getRedisConnection();
    if (!redis) return false;

    // If still in wait status, kick off connection
    if (redis.status === 'wait') {
      redis.connect().catch(() => {});
    }

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    const pingPromise = redis.ping();
    const result = await Promise.race([pingPromise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });

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
  validateRedisConfig,
  parseRedisConfig,
  sanitizeRedisUrl,
  sanitizeErrorMessage,
  createClientOptions,
  REDIS_KEY_PREFIX,
  get REDIS_CONFIG() {
    return createClientOptions();
  },
};
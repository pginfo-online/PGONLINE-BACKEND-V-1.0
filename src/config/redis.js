const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redisConnection = null;

// ==============================================================================
// Live AWS ElastiCache Serverless Redis Credentials (Hardcoded)
// ==============================================================================
// REDIS_URL=rediss://pginfo-redis-group:Jujutsu%409876543211%3D%3D123@pginfo-redis-fba3c7.serverless.use1.cache.amazonaws.com:6379
// REDIS_HOST=pginfo-redis-fba3c7.serverless.use1.cache.amazonaws.com
// REDIS_PORT=6379
// REDIS_USERNAME=pginfo-redis-group
// REDIS_PASSWORD=Jujutsu@9876543211==123
// REDIS_DB=0
// REDIS_KEY_PREFIX=pgm:
// REDIS_TLS=true
const LIVE_REDIS_CONFIG = {
  url: 'rediss://pginfo-redis-group:Jujutsu%409876543211%3D%3D123@pginfo-redis-fba3c7.serverless.use1.cache.amazonaws.com:6379',
  host: 'pginfo-redis-fba3c7.serverless.use1.cache.amazonaws.com',
  port: 6379,
  username: 'pginfo-redis-group',
  password: 'Jujutsu@9876543211==123',
  db: 0,
  keyPrefix: 'pgm:',
  tls: true,
};

// Hardcoded live credentials with environment fallback
const REDIS_HOST =
  process.env.REDIS_HOST &&
  process.env.REDIS_HOST !== '127.0.0.1' &&
  process.env.REDIS_HOST !== 'localhost'
    ? process.env.REDIS_HOST
    : LIVE_REDIS_CONFIG.host;

const REDIS_PORT = Number(
  process.env.REDIS_PORT && process.env.REDIS_PORT !== '6379'
    ? process.env.REDIS_PORT
    : LIVE_REDIS_CONFIG.port
);

const REDIS_USERNAME =
  process.env.REDIS_USERNAME || LIVE_REDIS_CONFIG.username;

const REDIS_PASSWORD =
  process.env.REDIS_PASSWORD || LIVE_REDIS_CONFIG.password;

const REDIS_DB = Number(
  process.env.REDIS_DB !== undefined
    ? process.env.REDIS_DB
    : LIVE_REDIS_CONFIG.db
);

const REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX || LIVE_REDIS_CONFIG.keyPrefix;

const isTls =
  process.env.REDIS_TLS !== undefined
    ? process.env.REDIS_TLS === 'true'
    : LIVE_REDIS_CONFIG.tls;

const REDIS_CONFIG = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
  db: REDIS_DB,
  connectTimeout: 5000,
  keepAlive: 10000,

  // AWS ElastiCache Serverless requires TLS with SNI servername
  tls: isTls
    ? {
        servername: REDIS_HOST,
      }
    : undefined,

  maxRetriesPerRequest: null,

  enableReadyCheck: true,

  retryStrategy: (times) => {
    // Stop retrying after 10 attempts to prevent infinite CPU / event loops
    if (times > 10) {
      if (!REDIS_CONFIG._hasLoggedMax) {
        REDIS_CONFIG._hasLoggedMax = true;
        logger.error('[Redis] Max reconnection attempts (10) reached. Reconnect stopped.');
      }
      return null;
    }

    const delay = Math.min(times * 300, 4000);

    // Throttle log output: only log once every 15s across all connections
    const now = Date.now();
    if (!REDIS_CONFIG._lastLogTime || now - REDIS_CONFIG._lastLogTime > 15000) {
      REDIS_CONFIG._lastLogTime = now;
      logger.warn(`[Redis] Connection retry in progress (delay: ${delay}ms, attempt: ${times})...`);
    }

    return delay;
  },

  reconnectOnError: (err) => {
    const targetErrors = [
      'READONLY',
      'ECONNRESET',
      'ECONNREFUSED',
    ];

    return targetErrors.some((error) =>
      err.message.includes(error)
    );
  },
};

const getRedisConnection = () => {
  if (redisConnection) {
    return redisConnection;
  }

  redisConnection = new Redis(REDIS_CONFIG);

  redisConnection.on('connect', () => {
    logger.info('✅ Redis TCP/TLS connection established');
  });

  redisConnection.on('ready', () => {
    logger.info('✅ Redis ready to accept commands');
  });

  redisConnection.on('error', (err) => {
    logger.error(`[Redis] ${err.message}`);
  });

  redisConnection.on('close', () => {
    logger.warn('⚠️ Redis connection closed');
  });

  return redisConnection;
};

const createWorkerConnection = () => {
  const workerClient = new Redis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: null,
  });

  // Attach silent error listener to prevent Node.js unhandled error events
  workerClient.on('error', () => {
    // Errors are handled and throttled at the worker level
  });

  return workerClient;
};

const disconnectRedis = async () => {
  if (!redisConnection) {
    return;
  }

  try {
    await redisConnection.quit();
    logger.info('👋 Redis disconnected gracefully');
  } catch (err) {
    logger.error(
      `❌ Redis disconnect error: ${err.message}`
    );

    redisConnection.disconnect();
  }

  redisConnection = null;
};

const isRedisHealthy = async (timeoutMs = 2500) => {
  try {
    const redis = getRedisConnection();
    if (!redis) return false;

    // Fast non-hanging ping check
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
  REDIS_KEY_PREFIX,
  REDIS_CONFIG,
  LIVE_REDIS_CONFIG,
};
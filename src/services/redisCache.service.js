const { getRedisConnection } = require('../config/redis');
const { logger } = require('../utils/logger');

/**
 * redisCache.service.js — Production-Grade Resilient Redis Cache Layer
 *
 * Principles:
 * 1. Redis is an accelerator, NEVER a single point of failure.
 * 2. Every operation is timeout-protected (1000ms max) and fails soft (returns null / false).
 * 3. Consistent, deterministic cache key namespacing with REDIS_KEY_PREFIX.
 * 4. Automatic JSON serialization / deserialization.
 * 5. Safe pattern-based invalidation with SCAN (never KEYS in production).
 */

const PREFIX = process.env.REDIS_KEY_PREFIX || 'pgm:';
const TIMEOUT_MS = Number(process.env.REDIS_TIMEOUT_MS) || 2500;

const withTimeout = (promise, ms = TIMEOUT_MS) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

class RedisCacheService {
  _getClient() {
    try {
      const client = getRedisConnection();
      if (!client || client.status === 'end') return null;
      return client;
    } catch (err) {
      logger.warn(`[RedisCache] Could not acquire Redis connection: ${err.message}`);
      return null;
    }
  }

  _formatKey(key) {
    if (key.startsWith(PREFIX)) return key;
    return `${PREFIX}${key}`;
  }

  /**
   * Get cached JSON object by key
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    try {
      const client = this._getClient();
      if (!client) return null;

      const fullKey = this._formatKey(key);
      const data = await withTimeout(client.get(fullKey));
      if (!data) return null;

      return JSON.parse(data);
    } catch (err) {
      logger.warn(`[RedisCache] GET error for key "${key}": ${err.message}`);
      return null;
    }
  }

  /**
   * Set cached JSON object with TTL in seconds
   * @param {string} key
   * @param {any} value
   * @param {number} ttlSeconds - Default 300s (5 mins)
   * @returns {Promise<boolean>}
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      const client = this._getClient();
      if (!client) return false;

      const fullKey = this._formatKey(key);
      const serialized = JSON.stringify(value);

      if (ttlSeconds > 0) {
        await withTimeout(client.set(fullKey, serialized, 'EX', ttlSeconds));
      } else {
        await withTimeout(client.set(fullKey, serialized));
      }
      return true;
    } catch (err) {
      logger.warn(`[RedisCache] SET error for key "${key}": ${err.message}`);
      return false;
    }
  }

  /**
   * Delete specific key
   * @param {string} key
   */
  async del(key) {
    try {
      const client = this._getClient();
      if (!client) return false;

      const fullKey = this._formatKey(key);
      await withTimeout(client.del(fullKey));
      return true;
    } catch (err) {
      logger.warn(`[RedisCache] DEL error for key "${key}": ${err.message}`);
      return false;
    }
  }

  /**
   * Delete keys by pattern using SCAN (production-safe, non-blocking)
   * @param {string} pattern - e.g. 'search:properties:*'
   */
  async delByPattern(pattern) {
    try {
      const client = this._getClient();
      if (!client) return false;

      const fullPattern = this._formatKey(pattern);
      let cursor = '0';
      do {
        const [nextCursor, keys] = await withTimeout(client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100));
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          await withTimeout(client.del(...keys));
        }
      } while (cursor !== '0');

      return true;
    } catch (err) {
      logger.warn(`[RedisCache] delByPattern error for "${pattern}": ${err.message}`);
      return false;
    }
  }
}

module.exports = new RedisCacheService();

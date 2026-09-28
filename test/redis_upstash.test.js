const assert = require('assert');
require('dotenv').config();

const {
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
} = require('../src/config/redis');

const redisCache = require('../src/services/redisCache.service');

async function runTestSuite() {
  console.log('🧪 Starting Upstash Redis Production Test Suite...\n');

  // ─── Test 1: Configuration Parsing & Sanitization ─────────────────────────
  console.log('▶ Test 1: URL Parsing and Credential Sanitization');
  {
    const rawUrl = 'rediss://default:superSecretPassword123@my-host.upstash.io:6379';
    const sanitized = sanitizeRedisUrl(rawUrl);
    assert(!sanitized.includes('superSecretPassword123'), 'Sanitized URL must NEVER contain password');
    assert(sanitized.includes('my-host.upstash.io'), 'Sanitized URL should retain hostname');

    const errorMsg = 'Error connecting to rediss://default:superSecretPassword123@my-host.upstash.io:6379: ETIMEDOUT';
    const sanitizedMsg = sanitizeErrorMessage(errorMsg);
    assert(!sanitizedMsg.includes('superSecretPassword123'), 'Sanitized error message must not leak password');

    const parsed = parseRedisConfig();
    assert(parsed !== null, 'parseRedisConfig must return parsed object when REDIS_URL is set');
    assert.strictEqual(parsed.protocol, 'rediss:', 'Protocol must be rediss:');
    assert.strictEqual(parsed.isTls, true, 'isTls must be true for rediss:');
    assert.strictEqual(parsed.port, 6379, 'Default port should be 6379');
    console.log('  ✅ Configuration parsing and credential sanitization passed');
  }

  // ─── Test 2: Production Configuration Validation Rules ───────────────────
  console.log('▶ Test 2: Production Configuration Validation & Guardrails');
  {
    const originalEnv = process.env.NODE_ENV;
    const originalUrl = process.env.REDIS_URL;

    try {
      // Test missing REDIS_URL in production
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = '';
      assert.throws(() => {
        validateRedisConfig();
      }, /Missing REDIS_URL environment variable/);

      // Test insecure protocol (redis://) in production
      process.env.REDIS_URL = 'redis://default:pass@endpoint.upstash.io:6379';
      assert.throws(() => {
        validateRedisConfig();
      }, /Insecure protocol/);

      // Test localhost / 127.0.0.1 in production
      process.env.REDIS_URL = 'rediss://default:pass@127.0.0.1:6379';
      assert.throws(() => {
        validateRedisConfig();
      }, /Localhost \/ 127.0.0.1 is not permitted/);

      // Test valid rediss:// in production
      process.env.REDIS_URL = originalUrl;
      const validProd = validateRedisConfig();
      assert.strictEqual(validProd, true, 'Valid Upstash rediss:// URL must pass in production');
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.REDIS_URL = originalUrl;
    }
    console.log('  ✅ Production validation guardrails passed');
  }

  // ─── Test 3: Client Options & BullMQ Compatibility ───────────────────────
  console.log('▶ Test 3: Client Options & BullMQ Compatibility');
  {
    const options = createClientOptions();
    assert.strictEqual(options.maxRetriesPerRequest, null, 'maxRetriesPerRequest must be null for BullMQ compatibility');
    assert.strictEqual(options.enableReadyCheck, true, 'enableReadyCheck must be true for production');
    assert.strictEqual(options.lazyConnect, true, 'lazyConnect must be true for non-blocking startup');
    assert(options.tls && options.tls.servername, 'TLS SNI servername must be configured');
    assert.strictEqual(typeof options.retryStrategy, 'function', 'retryStrategy must be a function');

    // Test retryStrategy exponential backoff
    const delay1 = options.retryStrategy(1);
    const delay5 = options.retryStrategy(5);
    assert(typeof delay1 === 'number' && delay1 > 0, 'Retry delay must be positive number');
    assert(delay5 >= delay1, 'Retry strategy must implement backoff');

    console.log('  ✅ Client options verified (TLS, SNI, BullMQ compatibility, backoff)');
  }

  // ─── Test 4: Singleton Pattern Verification ──────────────────────────────
  console.log('▶ Test 4: Singleton Client Verification');
  {
    const client1 = getRedisConnection();
    const client2 = getRedisConnection();
    assert.strictEqual(client1, client2, 'getRedisConnection must return the exact same singleton instance');
    console.log('  ✅ Singleton client pattern verified');
  }

  // ─── Test 5: Live Redis PING Health Check ────────────────────────────────
  console.log('▶ Test 5: Live PING Health Check');
  {
    const isHealthy = await isRedisHealthy(4000);
    assert.strictEqual(isHealthy, true, 'isRedisHealthy must return true with configured Upstash credentials');
    console.log('  ✅ Live PING -> PONG health check passed');
  }

  // ─── Test 6: Cache Operations (SET, GET, DEL, Namespacing) ───────────────
  console.log('▶ Test 6: Caching Operations (SET, GET, DEL, Namespacing)');
  {
    const testKey = `test:suite:${Date.now()}`;
    const testData = {
      user: 'tenant_123',
      name: 'Test Tenant',
      amount: 8500,
      active: true,
      tags: ['single', 'furnished'],
    };

    // SET
    const setOk = await redisCache.set(testKey, testData, 30);
    assert.strictEqual(setOk, true, 'redisCache.set should return true');

    // GET
    const retrieved = await redisCache.get(testKey);
    assert.deepStrictEqual(retrieved, testData, 'redisCache.get must return identical data structure');

    // DEL
    const delOk = await redisCache.del(testKey);
    assert.strictEqual(delOk, true, 'redisCache.del should return true');

    // GET after DEL
    const afterDel = await redisCache.get(testKey);
    assert.strictEqual(afterDel, null, 'redisCache.get after del must return null');

    console.log('  ✅ Caching GET, SET, DEL operations verified');
  }

  // ─── Test 7: TTL & Expiration ─────────────────────────────────────────────
  console.log('▶ Test 7: Key Expiration / TTL Verification');
  {
    const ttlKey = `test:ttl:${Date.now()}`;
    await redisCache.set(ttlKey, { expires: true }, 1); // 1 second TTL

    const client = getRedisConnection();
    const fullKey = ttlKey.startsWith(REDIS_KEY_PREFIX) ? ttlKey : `${REDIS_KEY_PREFIX}${ttlKey}`;
    const ttlSeconds = await client.ttl(fullKey);
    assert(ttlSeconds >= 0 && ttlSeconds <= 1, 'Key TTL should be <= 1 second');

    // Wait 1.3 seconds for key to expire
    await new Promise((r) => setTimeout(r, 1300));
    const expiredData = await redisCache.get(ttlKey);
    assert.strictEqual(expiredData, null, 'Key must be expired and return null');

    console.log('  ✅ TTL expiration verified');
  }

  // ─── Test 8: Pattern-Based Bulk Deletion (SCAN) ──────────────────────────
  console.log('▶ Test 8: Non-blocking Pattern-based Deletion (SCAN)');
  {
    const batchPrefix = `test:batch:${Date.now()}:`;
    await redisCache.set(`${batchPrefix}1`, { id: 1 }, 30);
    await redisCache.set(`${batchPrefix}2`, { id: 2 }, 30);
    await redisCache.set(`${batchPrefix}3`, { id: 3 }, 30);

    const delPatternOk = await redisCache.delByPattern(`${batchPrefix}*`);
    assert.strictEqual(delPatternOk, true, 'delByPattern must return true');

    const item1 = await redisCache.get(`${batchPrefix}1`);
    const item2 = await redisCache.get(`${batchPrefix}2`);
    const item3 = await redisCache.get(`${batchPrefix}3`);
    assert.strictEqual(item1, null);
    assert.strictEqual(item2, null);
    assert.strictEqual(item3, null);

    console.log('  ✅ delByPattern SCAN-based invalidation verified');
  }

  // ─── Test 9: Graceful Shutdown ───────────────────────────────────────────
  console.log('▶ Test 9: Graceful Shutdown Lifecycle');
  {
    const workerClient = createWorkerConnection();
    assert(workerClient !== null, 'Worker connection should be created');

    await disconnectRedis(2000);

    // Verify singleton client was reset
    const newClient = getRedisConnection();
    assert(newClient !== null, 'New client can be initialized cleanly after disconnect');
    await disconnectRedis(2000);

    console.log('  ✅ Graceful shutdown and reconnection lifecycle verified');
  }

  console.log('\n🎉 ALL 9 REDIS TESTS PASSED FLAWLESSLY! 🎉\n');
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Redis test failed:', err);
    process.exit(1);
  });

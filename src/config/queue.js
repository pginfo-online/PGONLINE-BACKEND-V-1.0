const { Queue, Worker } = require('bullmq');
const { getRedisConnection, createWorkerConnection, REDIS_KEY_PREFIX } = require('../config/redis');
const { logger } = require('../utils/logger');

/**
 * BullMQ Queue Manager
 *
 * Production-grade background job system for PG Management:
 *
 * Queues:
 *  1. pgm:rent-generation    — Auto-generate monthly rent records
 *  2. pgm:rent-reminders     — Send rent due/overdue reminders (WhatsApp/email/push)
 *  3. pgm:receipt-generation  — Generate PDF receipts after payment
 *  4. pgm:notifications       — Send push/WhatsApp/email notifications
 *  5. pgm:payment-links       — Generate Razorpay payment links
 *
 * Design principles:
 *  - Each queue has dedicated concurrency settings
 *  - Failed jobs are retried with exponential backoff
 *  - Dead letter queue after max retries
 *  - Job deduplication via jobId
 *  - Graceful shutdown support
 *  - Circuit breaker for Upstash quota exhaustion:
 *      On quota error → force-close workers locally (no Redis call needed)
 *      Recovery timer fires every 5 min → PING Redis → re-register workers
 */

const QUEUE_PREFIX = (REDIS_KEY_PREFIX || 'pgm').replace(/:+$/, '');

const QUEUE_NAMES = {
  RENT_GENERATION:   'rent-generation',
  RENT_REMINDERS:    'rent-reminders',
  RECEIPT_GENERATION:'receipt-generation',
  NOTIFICATIONS:     'notifications',
  PAYMENT_LINKS:     'payment-links',
};

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 24 * 3600,  // Keep completed jobs for 24 hours
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
  },
};

// Store queue/worker instances for reuse
const queues  = {};
const workers = {};

// Throttle error log lines to prevent console flooding
const errorLogThrottle = new Map();

const throttledLogError = (prefix, message, intervalMs = 20000) => {
  const now   = Date.now();
  const entry = errorLogThrottle.get(prefix) || { lastTime: 0, count: 0 };
  entry.count++;

  if (now - entry.lastTime > intervalMs) {
    const suffix = entry.count > 1 ? ` (${entry.count - 1} duplicate errors suppressed)` : '';
    logger.error(`[${prefix}] ${message}${suffix}`);
    entry.lastTime = now;
    entry.count    = 0;
  }
  errorLogThrottle.set(prefix, entry);
};

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
//
// On quota exhaustion or connection failure:
//   1. First error → force-close all workers locally (no Redis write needed).
//   2. Log a clear error message.
//   3. No automatic recovery — restart the server after resolving the Redis issue.

const UPSTASH_QUOTA_ERROR_RE = /max requests limit exceeded/i;
const CONN_CLOSED_RE         = /connection is closed/i;

let circuitOpen = false;


/**
 * Returns true if the error is an Upstash quota exhaustion error.
 */
const isQuotaError = (err) =>
  err && typeof err.message === 'string' && UPSTASH_QUOTA_ERROR_RE.test(err.message);

/**
 * Returns true if the error is a "connection closed" error that occurs
 * after ioredis drops the connection due to quota exhaustion.
 */
const isConnClosedError = (err) =>
  err && typeof err.message === 'string' && CONN_CLOSED_RE.test(err.message);

/**
 * Force-close all BullMQ workers locally.
 *
 * Unlike worker.pause(), worker.close(force=true) does NOT write to Redis —
 * it simply stops the event loop and tears down the local instance.
 * This is safe to call even when the Redis connection is already closed.
 */
const closeAllWorkers = async () => {
  const names = Object.keys(workers);
  await Promise.allSettled(
    names.map(async (name) => {
      const worker = workers[name];
      try {
        await worker.close(/* force= */ true);
        logger.warn(`[Circuit:${name}] Worker force-closed (quota exhausted)`);
      } catch (err) {
        // Already closed — not an error
        if (!CONN_CLOSED_RE.test(err.message)) {
          logger.error(`[Circuit:${name}] close() error: ${err.message}`);
        }
      }
      delete workers[name];
    })
  );
};

/**
 * Open the circuit breaker.
 *  - Force-closes all workers locally (no Redis call needed).
 *  - Logs a clear error.
 *  - No automatic recovery — restart the server once quota resets / plan upgraded.
 */
const openCircuit = () => {
  if (circuitOpen) return; // Already tripped — ignore subsequent errors
  circuitOpen = true;

  logger.error(
    '[CircuitBreaker] Redis connection failed (quota exhausted or connection closed). ' +
    'All workers have been shut down. ' +
    'No automatic recovery — restart the server after resolving the Redis issue. ' +
    'See https://upstash.com/docs/redis/troubleshooting/max_requests_limit'
  );

  // Close workers without touching Redis
  closeAllWorkers().catch(() => {});
};

/**
 * Get or create a BullMQ Queue instance.
 */

const getQueue = (queueName) => {
  if (queues[queueName]) return queues[queueName];

  const connection = getRedisConnection();
  const queue = new Queue(queueName, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queue.on('error', (err) => {
    if (isQuotaError(err) || isConnClosedError(err)) {
      openCircuit();
    } else {
      throttledLogError(`Queue:${queueName}`, `Queue error: ${err.message}`);
    }
  });

  queues[queueName] = queue;
  return queue;
};

/**
 * Register a BullMQ Worker for a queue.
 *
 * @param {string}   queueName
 * @param {Function} processor  — async (job) => result
 * @param {object}   opts       — { concurrency?: number }
 */
const registerWorker = (queueName, processor, opts = {}) => {
  // If a stale worker exists (e.g. after circuit recovery), skip re-registering
  // the same name — caller should have cleared workers{} via closeAllWorkers() already.
  const connection  = createWorkerConnection();
  const concurrency = opts.concurrency || 5;

  const worker = new Worker(queueName, processor, {
    connection,
    prefix: QUEUE_PREFIX,
    concurrency,
    limiter: opts.limiter || undefined,
    // Reduce idle polling pressure on Upstash free tier:
    stalledInterval: 60_000, // Check for stalled jobs every 60s (default: 30s)
    drainDelay:      10,     // Wait 10ms when queue is empty before re-checking
  });

  worker.on('completed', (job) => {
    logger.info(`[Worker:${queueName}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    if (isQuotaError(err) || isConnClosedError(err)) {
      openCircuit();
    } else {
      logger.error(`[Worker:${queueName}] Job ${job?.id} failed: ${err.message}`);
    }
  });

  worker.on('error', (err) => {
    if (isQuotaError(err) || isConnClosedError(err)) {
      openCircuit();
    } else {
      throttledLogError(`Worker:${queueName}`, `Worker error: ${err.message}`);
    }
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`[Worker:${queueName}] Job ${jobId} stalled`);
  });

  workers[queueName] = worker;
  logger.info(`[BullMQ] Worker registered: ${queueName} (concurrency: ${concurrency})`);
  return worker;
};

// ─── Convenience job-add helpers ────────────────────────────────────────────

const addRentGenerationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RENT_GENERATION);
  const jobId = `rent-gen-${data.pgId}-${data.month}-${data.year}`;
  return queue.add('generate-rent', data, { ...opts, jobId });
};

const addRentReminderJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RENT_REMINDERS);
  const jobId = `reminder-${data.rentRecordId}-${data.channel}-${Date.now()}`;
  return queue.add('send-reminder', data, { ...opts, jobId });
};

const addReceiptGenerationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RECEIPT_GENERATION);
  const jobId = `receipt-${data.rentRecordId || data.paymentId}-${Date.now()}`;
  return queue.add('generate-receipt', data, { ...opts, jobId });
};

const addNotificationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
  const jobId = `notif-${data.type}-${data.recipientId || 'bulk'}-${Date.now()}`;
  return queue.add('send-notification', data, { ...opts, jobId });
};

const addPaymentLinkJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.PAYMENT_LINKS);
  const jobId = `paylink-${data.rentRecordId}-${Date.now()}`;
  return queue.add('create-payment-link', data, { ...opts, jobId });
};

const scheduleRepeatingJob = async (queueName, jobName, data, pattern) => {
  const queue = getQueue(queueName);
  return queue.add(jobName, data, {
    repeat: { pattern },
    jobId: `${jobName}-repeating`,
  });
};

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

const shutdownQueues = async () => {
  logger.info('[BullMQ] Shutting down...');


  for (const [name, worker] of Object.entries(workers)) {
    try {
      await worker.close();
      logger.info(`  [BullMQ] Worker "${name}" closed`);
    } catch (err) {
      logger.error(`  [BullMQ] Worker "${name}" close error: ${err.message}`);
    }
  }

  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      logger.info(`  [BullMQ] Queue "${name}" closed`);
    } catch (err) {
      logger.error(`  [BullMQ] Queue "${name}" close error: ${err.message}`);
    }
  }
};

module.exports = {
  QUEUE_NAMES,
  getQueue,
  registerWorker,
  addRentGenerationJob,
  addRentReminderJob,
  addReceiptGenerationJob,
  addNotificationJob,
  addPaymentLinkJob,
  scheduleRepeatingJob,
  shutdownQueues,
  // For health-check / admin endpoints
  get isCircuitOpen() { return circuitOpen; },
};

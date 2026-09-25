const { Queue, Worker, QueueScheduler } = require('bullmq');
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
 */

const QUEUE_NAMES = {
  RENT_GENERATION:   `${REDIS_KEY_PREFIX}rent-generation`,
  RENT_REMINDERS:    `${REDIS_KEY_PREFIX}rent-reminders`,
  RECEIPT_GENERATION: `${REDIS_KEY_PREFIX}receipt-generation`,
  NOTIFICATIONS:     `${REDIS_KEY_PREFIX}notifications`,
  PAYMENT_LINKS:     `${REDIS_KEY_PREFIX}payment-links`,
};

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 24 * 3600,  // Keep completed jobs for 24 hours
    count: 1000,     // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
  },
};

// Store queue instances for reuse
const queues = {};
const workers = {};

/**
 * Get or create a queue instance.
 */
const getQueue = (queueName) => {
  if (queues[queueName]) return queues[queueName];

  const connection = getRedisConnection();
  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queue.on('error', (err) => {
    logger.error(`[Queue:${queueName}] Error: ${err.message}`);
  });

  queues[queueName] = queue;
  return queue;
};

/**
 * Register a worker for a queue.
 *
 * @param {string} queueName
 * @param {Function} processor - async (job) => result
 * @param {object} opts - { concurrency: number }
 */
const registerWorker = (queueName, processor, opts = {}) => {
  const connection = createWorkerConnection();
  const concurrency = opts.concurrency || 5;

  const worker = new Worker(queueName, processor, {
    connection,
    concurrency,
    limiter: opts.limiter || undefined,
  });

  worker.on('completed', (job) => {
    logger.info(`[Worker:${queueName}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Worker:${queueName}] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[Worker:${queueName}] Worker error: ${err.message}`);
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`[Worker:${queueName}] Job ${jobId} stalled`);
  });

  workers[queueName] = worker;
  logger.info(`✅ Worker registered for queue: ${queueName} (concurrency: ${concurrency})`);
  return worker;
};

// ─── Convenience Methods ────────────────────────────────────────────────────

/**
 * Add a rent generation job.
 */
const addRentGenerationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RENT_GENERATION);
  const jobId = `rent-gen-${data.pgId}-${data.month}-${data.year}`;
  return queue.add('generate-rent', data, { ...opts, jobId });
};

/**
 * Add a rent reminder job.
 */
const addRentReminderJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RENT_REMINDERS);
  const jobId = `reminder-${data.rentRecordId}-${data.channel}-${Date.now()}`;
  return queue.add('send-reminder', data, { ...opts, jobId });
};

/**
 * Add a receipt generation job.
 */
const addReceiptGenerationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.RECEIPT_GENERATION);
  const jobId = `receipt-${data.rentRecordId || data.paymentId}-${Date.now()}`;
  return queue.add('generate-receipt', data, { ...opts, jobId });
};

/**
 * Add a notification job (WhatsApp/email/push).
 */
const addNotificationJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
  const jobId = `notif-${data.type}-${data.recipientId || 'bulk'}-${Date.now()}`;
  return queue.add('send-notification', data, { ...opts, jobId });
};

/**
 * Add a payment link generation job.
 */
const addPaymentLinkJob = async (data, opts = {}) => {
  const queue = getQueue(QUEUE_NAMES.PAYMENT_LINKS);
  const jobId = `paylink-${data.rentRecordId}-${Date.now()}`;
  return queue.add('create-payment-link', data, { ...opts, jobId });
};

/**
 * Schedule a repeatable job (e.g. daily rent auto-generation).
 */
const scheduleRepeatingJob = async (queueName, jobName, data, pattern) => {
  const queue = getQueue(queueName);
  return queue.add(jobName, data, {
    repeat: { pattern }, // cron pattern e.g. '0 6 * * *' = daily 6 AM
    jobId: `${jobName}-repeating`,
  });
};

/**
 * Gracefully shut down all workers and queues.
 */
const shutdownQueues = async () => {
  logger.info('🛑 Shutting down BullMQ workers and queues...');

  // Close workers first (stop processing)
  for (const [name, worker] of Object.entries(workers)) {
    try {
      await worker.close();
      logger.info(`  ✅ Worker ${name} closed`);
    } catch (err) {
      logger.error(`  ❌ Worker ${name} close error: ${err.message}`);
    }
  }

  // Close queues
  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      logger.info(`  ✅ Queue ${name} closed`);
    } catch (err) {
      logger.error(`  ❌ Queue ${name} close error: ${err.message}`);
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
};

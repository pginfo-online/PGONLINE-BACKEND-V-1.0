require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const connectDB = require('./src/config/db');
const { disconnectDB } = connectDB;
const { validateRedisConfig, isRedisHealthy, disconnectRedis } = require('./src/config/redis');
const v1Routes = require('./src/routes/v1/index');
const errorMiddleware = require('./src/middlewares/error.middleware');
const { logger } = require('./src/utils/logger');
const { startScheduler } = require('./src/services/notification/notification.scheduler');
const { startExportScheduler } = require('./src/services/export.scheduler');
const { startBuffetSchedulers } = require('./src/services/buffet/buffet.scheduler');
const { startHotDealScheduler } = require('./src/services/hotDeal.scheduler');

const app = express();
const PORT = process.env.PORT || 5001;

// ─── Process Crash Protection ──────────────────────────────────────────────────
// In production, an uncaught exception leaves the process in an undefined state.
// Log error details and exit so PM2 / systemd / Docker can restart a clean worker.
process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION! 💥 ${err.name}: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION! 💥 Reason:', reason);
});

// ─── Trust Proxy for AWS ALB / CloudFront / Nginx ─────────────────────────────
const trustProxyConfig = process.env.TRUST_PROXY || '1';
app.set(
  'trust proxy',
  trustProxyConfig === 'true'
    ? true
    : trustProxyConfig === 'false'
      ? false
      : isNaN(Number(trustProxyConfig))
        ? trustProxyConfig
        : Number(trustProxyConfig)
);

// ─── Security & Performance Middleware ────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(mongoSanitize());
app.use(compression());

// ─── Robust & Dynamic CORS Setup ──────────────────────────────────────────────
const defaultOrigins = [
  'https://www.pginfo.in',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
];

const userConfiguredOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean)
  : [];

const configuredOrigins = Array.from(new Set([...defaultOrigins, ...userConfiguredOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow mobile apps, curl, Postman, server-to-server requests (no origin header)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/$/, '');

    // Always allow localhost origins for local frontend development
    if (
      normalizedOrigin.startsWith('http://localhost:') ||
      normalizedOrigin.startsWith('http://127.0.0.1:') ||
      normalizedOrigin === 'http://localhost' ||
      normalizedOrigin === 'http://127.0.0.1'
    ) {
      return callback(null, true);
    }

    if (configuredOrigins.includes('*') || configuredOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    // In production, reject unauthorized origins
    if (process.env.NODE_ENV === 'production') {
      logger.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
      return callback(new Error(`CORS policy does not allow access from origin: ${origin}`), false);
    }

    // Fallback for development/testing
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/', limiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Raw body capture for Razorpay webhook signature verification
app.use(
  '/api/v1/manage/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, _res, next) => {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // Keep body as-is if parsing fails
    }
    next();
  }
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request Loggerr ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // Only log client/server errors (status >= 400) in production to keep PM2 console clean
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode < 400 || req.url.startsWith('/health'),
    })
  );
} else {
  app.use(morgan('dev'));
}

// ─── Health Checks (AWS Target Group / ALB / ECS / Route53) ───────────────────
app.get('/health', async (req, res) => {
  const mongoose = require('mongoose');
  const isDbConnected = mongoose.connection.readyState === 1;
  const dbStates = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const memoryUsage = process.memoryUsage();

  // Fast, non-blocking check for Redis health (PING -> PONG)
  const isRedisConnected = await isRedisHealthy(1500);

  const isHealthy = isDbConnected && isRedisConnected;
  const isDegraded = isDbConnected && !isRedisConnected;

  const healthPayload = {
    success: isDbConnected,
    status: isHealthy ? 'UP' : isDegraded ? 'DEGRADED' : 'DOWN',
    message: isHealthy
      ? 'PGinfo.online API is fully operational'
      : isDegraded
        ? 'PGinfo.online API is running in degraded mode (Redis offline)'
        : 'Database connection unavailable',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: `${Math.round(process.uptime())}s`,
    database: {
      status: dbStates[mongoose.connection.readyState] || 'unknown',
      connected: isDbConnected,
    },
    redis: {
      status: isRedisConnected ? 'connected' : 'disconnected',
      connected: isRedisConnected,
    },
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
    },
    instanceId: process.env.NODE_APP_INSTANCE || 'standalone',
  };

  res.status(isDbConnected ? 200 : 503).json(healthPayload);
});

// Lightweight liveness probe (checks if Node process is responsive)
app.get('/health/live', (_req, res) => {
  res.status(200).send('OK');
});

// Lightweight readiness probe (checks if server is ready to accept traffic)
app.get('/health/ready', async (_req, res) => {
  const mongoose = require('mongoose');
  const isDbReady = mongoose.connection.readyState === 1;
  const isRedisReady = await isRedisHealthy(1500);

  if (isDbReady && isRedisReady) {
    return res.status(200).send('READY');
  }
  return res.status(503).send('NOT_READY');
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1', v1Routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Server Startup & PM2 Cluster Coordination ────────────────────────────────
let server;

const startServer = async () => {
  try {
    // 1. Validate Redis configuration (fails fast in production if REDIS_URL is missing or invalid)
    validateRedisConfig();

    // 2. Establish database connection before accepting traffic
    await connectDB();

    // 2. Schedulers: In PM2 cluster mode, run only on primary instance (instance 0)
    const isPrimaryInstance = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    const schedulersEnabled = process.env.ENABLE_SCHEDULERS !== 'false';

    if (isPrimaryInstance && schedulersEnabled) {
      logger.info('🕒 Starting background schedulers on primary instance...');
     // startScheduler();
    //  startExportScheduler();
     // startBuffetSchedulers();
     // startHotDealScheduler();
     // logger.info('✅ Background schedulers active (notification, export, buffet, hot deals)');

      // BullMQ Background Workers for PG Management
      try {
        const { initializeWorkers } = require('./src/services/workers/queue.workers');
        initializeWorkers()
          .then(() => logger.info('✅ BullMQ workers & repeating jobs active'))
          .catch((err) => logger.warn(`⚠️ BullMQ worker initialization deferred: ${err.message}`));
      } catch (err) {
        logger.warn(`⚠️ BullMQ worker loader warning: ${err.message}`);
      }
    } else if (!isPrimaryInstance) {
      logger.info(`ℹ️ Schedulers skipped on worker instance ${process.env.NODE_APP_INSTANCE}`);
    }

    // 3. Start listening for incoming HTTP requests (bound to 0.0.0.0 for Nginx IPv4 reverse proxy)
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(
        `🚀 PGinfo.online API running on port ${PORT} [${process.env.NODE_ENV || 'development'}] (Worker: ${process.env.NODE_APP_INSTANCE || 'standalone'
        })`
      );

      // Signal PM2 that the application is fully online and ready for zero-downtime reloads
      if (process.send) {
        process.send('ready');
      }
    });

    server.on('error', (err) => {
      logger.error(`❌ HTTP Server error: ${err.message}`);
      process.exit(1);
    });
  } catch (err) {
    logger.error(`❌ Fatal server startup error: ${err.message}`);
    process.exit(1);
  }
};

startServer();

// ─── Graceful Shutdown Handling (AWS EC2 / PM2 / Docker / ECS) ────────────────
let isShuttingDown = false;

const handleGracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.warn(`🛑 Received ${signal}. Initiating graceful shutdown...`);

  // Force exit after timeout if connections take too long to close
  const shutdownTimeout = setTimeout(() => {
    logger.error('⏰ Shutdown timeout reached (10s). Forcing process exit.');
    process.exit(1);
  }, 10000);

  try {
    // 1. Stop accepting new HTTP requests
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('🔒 HTTP server closed: No more incoming connections accepted');
    }

    // 2. Disconnect from database
    if (disconnectDB) {
      await disconnectDB();
    }

    // 3. Gracefully shutdown BullMQ queues and workers
    try {
      const { shutdownQueues } = require('./src/config/queue');
      await shutdownQueues();
    } catch (_) { }

    // 4. Gracefully disconnect Redis client and connections
    try {
      await disconnectRedis();
    } catch (_) { }

    clearTimeout(shutdownTimeout);
    logger.info('👋 Graceful shutdown completed cleanly');
    process.exit(0);
  } catch (err) {
    logger.error(`❌ Error during graceful shutdown: ${err.message}`);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

module.exports = app;


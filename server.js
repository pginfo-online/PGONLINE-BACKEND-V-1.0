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
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://127.0.0.1:5173',
];

const configuredOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean)
  : defaultOrigins;

app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps, curl, Postman, server-to-server requests (no origin header)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/$/, '');

    // In non-production mode, dynamically allow any localhost origin
    if (process.env.NODE_ENV !== 'production') {
      if (
        normalizedOrigin.startsWith('http://localhost:') ||
        normalizedOrigin.startsWith('http://127.0.0.1:') ||
        normalizedOrigin === 'http://localhost' ||
        normalizedOrigin === 'http://127.0.0.1'
      ) {
        return callback(null, true);
      }
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
}));

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

// ─── Request Logger ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // Use combined Apache format in production, skip health check polling noise
  app.use(
    morgan('combined', {
      skip: (req) => req.url === '/health' || req.url === '/health/live' || req.url === '/health/ready',
    })
  );
} else {
  app.use(morgan('dev'));
}

// ─── Health Checks (AWS Target Group / ALB / ECS / Route53) ───────────────────
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const isDbConnected = mongoose.connection.readyState === 1;
  const dbStates = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const memoryUsage = process.memoryUsage();

  const healthPayload = {
    success: isDbConnected,
    status: isDbConnected ? 'UP' : 'DEGRADED',
    message: isDbConnected ? 'PGinfo.online API is running' : 'Database connection unavailable',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: `${Math.round(process.uptime())}s`,
    database: {
      status: dbStates[mongoose.connection.readyState] || 'unknown',
      connected: isDbConnected,
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
app.get('/health/ready', (_req, res) => {
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState === 1) {
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
    // 1. Establish database connection before accepting traffic
    await connectDB();

    // 2. Schedulers: In PM2 cluster mode, run only on primary instance (instance 0)
    const isPrimaryInstance = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    const schedulersEnabled = process.env.ENABLE_SCHEDULERS !== 'false';

    if (isPrimaryInstance && schedulersEnabled) {
      logger.info('🕒 Starting background schedulers on primary instance...');
      startScheduler();
      startExportScheduler();
      startBuffetSchedulers();
      startHotDealScheduler();
      logger.info('✅ Background schedulers active (notification, export, buffet, hot deals)');
    } else if (!isPrimaryInstance) {
      logger.info(`ℹ️ Schedulers skipped on worker instance ${process.env.NODE_APP_INSTANCE}`);
    }

    // 3. Start listening for incoming HTTP requests
    server = app.listen(PORT, () => {
      logger.info(
        `🚀 PGinfo.online API running on port ${PORT} [${process.env.NODE_ENV || 'development'}] (Worker: ${
          process.env.NODE_APP_INSTANCE || 'standalone'
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


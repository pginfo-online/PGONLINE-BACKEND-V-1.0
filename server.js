require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const connectDB = require('./src/config/db');
const v1Routes = require('./src/routes/v1/index');
const errorMiddleware = require('./src/middlewares/error.middleware');
const { logger } = require('./src/utils/logger');
const { startScheduler } = require('./src/services/notification/notification.scheduler');
const { startExportScheduler } = require('./src/services/export.scheduler');

const app = express();
const PORT = process.env.PORT || 5001;

// ─── Process Crash Protection ──────────────────────────────────────────────────
// Prevent unhandled promise rejections or exceptions from terminating the Node server.
process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION! 💥 ${err.name}: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION! 💥 Reason:', reason);
});

// ─── Trust Proxy for Render / Heroku ──────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Connect Database ───────────────────────────────────────────────────
connectDB().then(() => {
  // Start schedulers after DB is ready
  startScheduler();
  startExportScheduler();
});

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(mongoSanitize());

// ─── Robust & Dynamic CORS Setup ──────────────────────────────────────────────
// Must run BEFORE rate limiting & routes so preflights & errors receive CORS headers.
const configuredOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://localhost:8081', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server, mobile app, Postman, or non-browser requests
    if (!origin) return callback(null, true);

    // In development mode, dynamically allow any localhost or 127.0.0.1 origin
    if (process.env.NODE_ENV !== 'production') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin === 'http://localhost' || origin === 'http://127.0.0.1') {
        return callback(null, true);
      }
    }

    if (configuredOrigins.includes(origin) || configuredOrigins.includes('*')) {
      return callback(null, true);
    }

    // Fallback in dev/testing: allow to prevent CORS blockage
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // increased max requests per window
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/', limiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Raw body capture for Razorpay webhook signature verification
app.use('/api/v1/manage/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }),
  (req, _res, next) => { req.rawBody = req.body; req.body = JSON.parse(req.body); next(); }
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logger ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'PGinfo.online API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1', v1Routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 PGinfo.online API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;

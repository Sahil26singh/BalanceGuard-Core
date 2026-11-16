import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './config/db.js';
import { redisClient } from './config/redis.js';
import { errorHandler } from './middleware/errorHandler.js';

import { authRouter } from './modules/auth/auth.routes.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';
import { refundsRouter } from './modules/refunds/refunds.routes.js';
import { ledgerRouter } from './modules/ledger/ledger.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { webhooksRouter } from './modules/webhooks/webhooks.routes.js';
import { reconciliationRouter, internalCronRouter } from './modules/reconciliation/reconciliation.routes.js';
import { riskRouter } from './modules/risk/risk.routes.js';
import { reviewRouter } from './modules/review/review.routes.js';

export const app = express();

// Render sits in front of the app, so trust it for the real client IP (used by rate limiting)
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// Keep the raw body: webhook signatures are verified against the exact bytes we received
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

// Instant, never touches the database or Redis. Safe for uptime pings and the frontend wake-up check.
app.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

// Checks PostgreSQL and Redis. For manual use: it can wake a sleeping Neon database.
app.get('/health/deep', async (req, res) => {
  const check = async (probe) => {
    const startedAt = Date.now();
    try {
      await probe();
      return { status: 'HEALTHY', latencyMs: Date.now() - startedAt };
    } catch (err) {
      logger.warn({ err: err.message }, 'Deep health check failed');
      return { status: 'UNHEALTHY' };
    }
  };

  const database = await check(() => pool.query('SELECT 1'));
  const redis = await check(() => redisClient.ping());
  const healthy = database.status === 'HEALTHY' && redis.status === 'HEALTHY';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'HEALTHY' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    diagnostics: { database, redis }
  });
});

// General rate limiter for /api endpoints: configurable via API_RATE_LIMIT_MAX (default: 5,000 in dev, 300 in prod)
// Skips provider webhook callbacks (verified via HMAC-SHA256 signature) and internal cron (verified via CRON_SECRET)
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const url = req.originalUrl || req.url || '';
    return url.startsWith('/api/webhooks/provider') || url.startsWith('/api/internal/cron/daily');
  },
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests from this IP, please try again after 15 minutes'
    }
  }
});

app.use('/api', generalApiLimiter);

app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transfers/:id/refunds', refundsRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/api/audit', auditRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/internal/cron', internalCronRouter);
app.use('/api/risk', riskRouter);
app.use('/api/review', reviewRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `Cannot ${req.method} ${req.originalUrl}` } });
});

app.use(errorHandler);

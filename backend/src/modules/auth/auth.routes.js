import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { parseBody } from '../../utils/errors.js';
import { authenticateUser, getUserById } from './auth.service.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login attempts per IP every 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again in 15 minutes.' } }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = parseBody(loginSchema, req.body, 'email or password format');
    const authResult = await authenticateUser(email, password);
    res.json(authResult);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User profile does not exist' } });
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// Demo logins for the public portfolio site. Only works when DEMO_MODE=true.
authRouter.get('/demo-credentials', (req, res) => {
  if (!env.DEMO_MODE) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo mode is disabled' } });
  }

  res.json({
    demoMode: true,
    credentials: [
      {
        role: 'admin',
        email: 'admin@balanceguard.local',
        password: env.SEED_ADMIN_PASSWORD,
        description: 'Full access: accounts, transfers, refunds, reconciliation'
      },
      {
        role: 'reviewer',
        email: 'reviewer@balanceguard.local',
        password: env.SEED_REVIEWER_PASSWORD,
        description: 'Compliance officer: review queue and read-only reports'
      }
    ]
  });
});

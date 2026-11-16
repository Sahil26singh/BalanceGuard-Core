import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load backend/.env no matter where the process was started from.
// On Render there is no .env file, so real environment variables are used.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

// "true"/"false" strings from the environment -> real booleans
const bool = (defaultValue) =>
  z.preprocess((v) => (v === undefined ? defaultValue : String(v).toLowerCase() === 'true'), z.boolean());

const optionalBool = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : String(v).toLowerCase() === 'true'),
  z.boolean().optional()
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url('DATABASE_URL must be a PostgreSQL connection URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a redis:// or rediss:// URL'),
  REDIS_KEY_PREFIX: z.string().min(1).default('bgc-dev'),

  DATABASE_SSL_REJECT_UNAUTHORIZED: optionalBool,
  DATABASE_CA_CERT: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  API_RATE_LIMIT_MAX: z.coerce
    .number()
    .int()
    .positive()
    .default(process.env.NODE_ENV === 'production' ? 300 : 5000),

  RUN_WORKER: bool(true),
  RUN_MIGRATIONS_ON_START: bool(process.env.NODE_ENV !== 'production'),
  DEMO_MODE: bool(process.env.NODE_ENV !== 'production'),
  ALLOW_PRODUCTION_DEMO_MODE: bool(false),

  // Optional: without a key, risk explanations use a plain template
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  HOLD_THRESHOLD: z.coerce.number().int().min(0).max(100).default(75),

  // No defaults on purpose: never ship a known password
  SEED_ADMIN_PASSWORD: z.string().min(8),
  SEED_REVIEWER_PASSWORD: z.string().min(8)
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (data.DEMO_MODE === true && !data.ALLOW_PRODUCTION_DEMO_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEMO_MODE'],
        message: 'DEMO_MODE is disabled in production. Set ALLOW_PRODUCTION_DEMO_MODE=true if this is an intentional demo deployment.'
      });
    }
    if (data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be at least 32 characters in production for cryptographic safety.'
      });
    }
    if (data.WEBHOOK_SIGNING_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SIGNING_SECRET'],
        message: 'WEBHOOK_SIGNING_SECRET must be at least 32 characters in production.'
      });
    }
    if (data.CRON_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: 'CRON_SECRET must be at least 32 characters in production.'
      });
    }
    if (data.SEED_ADMIN_PASSWORD.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_ADMIN_PASSWORD'],
        message: 'SEED_ADMIN_PASSWORD must be at least 12 characters in production.'
      });
    }
    if (data.SEED_REVIEWER_PASSWORD.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_REVIEWER_PASSWORD'],
        message: 'SEED_REVIEWER_PASSWORD must be at least 12 characters in production.'
      });
    }
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

export const env = parsed.data;

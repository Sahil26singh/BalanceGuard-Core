# Deployment guide

Everything here uses free plans: **Neon** (database), **Redis Cloud** (queues), **Render** (backend), **Cloudflare Pages** (frontend) and **cron-job.org** (daily job). Free plans and screens change, so if a menu looks different from what is written here, follow what you see.

Do the steps in this order. The backend comes first because the frontend needs its address.

## What to know first

- **Production secrets live only in the hosting dashboards.** Never put them in a file in the repo and never paste them into a chat.
- **Use different secrets and passwords for production than for development.**
- **Do not run `npm run benchmark` against production.** It adds many fake transfers and uses up the free database and Redis limits. `npm run smoke-test` is fine.
- **Free hosting sleeps.** Render stops the service after about 15 minutes without traffic and needs up to a minute to wake it. Neon's compute also sleeps. Do not keep the server awake with constant pings: that uses your free hours. Open the site once before an interview or demo.

## 0. Check the repository for secrets

Run these in the project folder before pushing to a public GitHub repository:

```bash
git ls-files | grep -i "\.env"            # should list only .env.example files
git log --all --oneline -- backend/.env    # should print nothing
```

If either shows a real `.env`, stop and remove it from git history before pushing.

## 1. Neon (production database)

1. In your Neon project, use the `main` branch for production (`dev` stays for development).
2. Copy the **direct** connection string of `main` (the host has no `-pooler`). This is the production `DATABASE_URL`.

The tables are created automatically when the backend starts (`RUN_MIGRATIONS_ON_START=true`).

## 2. Redis Cloud

Reuse the same free database. Production uses the key prefix `bgc-prod`, so it never mixes with `bgc-dev`. Check that the eviction policy is `noeviction` (see [cloud-setup.md](cloud-setup.md)).

## 3. Render (backend)

1. Render dashboard, **New +**, **Web Service**, connect your GitHub repository.
2. Settings:
   - **Runtime:** Node
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free
   - **Health Check Path:** `/health` (it never touches the database, so Render's checks do not keep Neon awake)
3. Add these environment variables. Render sets `PORT` itself, so do not add it.

| Key | Value |
|:---|:---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | direct Neon connection string of the `main` branch (with `?sslmode=require`) |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` (enforces strict TLS CA certificate verification) |
| `REDIS_URL` | your Redis Cloud URL (`rediss://...` for TLS) |
| `REDIS_KEY_PREFIX` | `bgc-prod` |
| `JWT_SECRET`, `WEBHOOK_SIGNING_SECRET`, `CRON_SECRET` | three new random strings of at least 32 characters (see below) |
| `CORS_ORIGIN` | the Cloudflare Pages URL, exactly, no trailing slash (put a placeholder now, fix it in step 5) |
| `RUN_WORKER` | `true` |
| `RUN_MIGRATIONS_ON_START` | `true` |
| `DEMO_MODE` | `true` (shows demo logins on login page) |
| `ALLOW_PRODUCTION_DEMO_MODE` | `true` (**Required** when `DEMO_MODE=true` in production; prevents accidental activation of demo mode in a real production system) |
| `GEMINI_API_KEY` | optional (from Google AI Studio) |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` |
| `HOLD_THRESHOLD` | `75` |
| `SEED_ADMIN_PASSWORD`, `SEED_REVIEWER_PASSWORD` | passwords made only for this demo, minimum 12 characters (visitors can read them from login page) |

Make random 32+ character secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Create the service. When it is live, open `https://<your-service>.onrender.com/health`. You should see `{"status":"OK",...}`.

## 4. Create the demo data (once)

The server creates the tables but not the demo users. Run the seed once from your computer, pointing it at the production database. The seed script creates two staff accounts:
- `admin@balanceguard.local` (Role: `admin` — full permissions to create transfers, top-ups, payouts, and refunds)
- `reviewer@balanceguard.local` (Role: `reviewer` — review queue and read-only reports)

The dev `.env` supplies the other values, so override the database and the demo passwords (minimum 12 characters) on the same command line:

macOS / Linux:

```bash
DATABASE_URL='<production-direct-url>' SEED_ADMIN_PASSWORD='<prod-admin-password-min-12-chars>' SEED_REVIEWER_PASSWORD='<prod-reviewer-password-min-12-chars>' npm run seed --prefix backend
```

Windows PowerShell:

```powershell
$env:DATABASE_URL='<production-direct-url>'; $env:SEED_ADMIN_PASSWORD='<prod-admin-password-min-12-chars>'; $env:SEED_REVIEWER_PASSWORD='<prod-reviewer-password-min-12-chars>'; npm run seed --prefix backend
```

The passwords must match the `SEED_ADMIN_PASSWORD` and `SEED_REVIEWER_PASSWORD` environment variables you configured on Render. Close that terminal afterwards so the values are not left in the session.

## 5. Cloudflare Pages (frontend)

1. Cloudflare dashboard, **Workers & Pages**, create a Pages project from your GitHub repository.
2. Settings:
   - **Root directory:** `frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `VITE_API_BASE_URL` = `https://<your-service>.onrender.com/api` (it must end in `/api`)
3. Deploy. `VITE_API_BASE_URL` is baked in at build time, so after changing it you must redeploy.
4. Go back to Render and set `CORS_ORIGIN` to the exact Pages address (for example `https://balanceguard-core.pages.dev`). Render redeploys. Pages preview URLs are not allowed on purpose.

`frontend/public/_redirects` makes page refreshes work on routes like `/transfers`.

## 6. cron-job.org (daily job)

1. Create a cron job:
   - **URL:** `https://<your-service>.onrender.com/api/internal/cron/daily`
   - **Method:** `POST`
   - **Schedule:** once a day
   - **Header:** `X-Cron-Secret` = your production `CRON_SECRET`
2. The endpoint only queues the work and answers `202`, and calling it twice in a day is safe.

A cold start can take close to a minute, which may be longer than the job's time limit. If the first call times out, add a second cron job that sends `GET /health` a few minutes earlier to wake the server.

## 7. Check the deployment

```bash
npm run smoke-test -- https://<your-service>.onrender.com
```

(Set `ADMIN_PASSWORD` to the production admin password first, because the script reads it from the environment.)

Checklist:

- [ ] `/health` answers on the Render URL
- [ ] You can log in on the Pages site and the "Ledger Balanced" badge is green
- [ ] The smoke test passes
- [ ] The Demo Lab "Retry same key x10" button shows one transfer created
- [ ] No `.env` file shows up in `git status`
- [ ] README has your live URL
- [ ] Record benchmark numbers (run against a local server, not production) in the README

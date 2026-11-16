# Cloud setup

BalanceGuard Core runs on free cloud services, with no Docker and no local database. Set up these three services before the first `npm run dev`:

1. **Neon**: PostgreSQL, with separate `dev` and `main` branches
2. **Redis Cloud**: queues and the risk velocity counters
3. **Google AI Studio**: a Gemini API key (optional: without a key, risk explanations use a plain template)

Free plans and screens change from time to time. If something here looks different, trust what you see on screen.

---

## 1. Neon PostgreSQL Setup (Branches: `dev` and `main`)

Neon gives you a free-tier PostgreSQL database with serverless branch isolation (just like git branches for your database).

### Step 1.1: Create Your Account & Project
1. Go to [https://neon.tech](https://neon.tech) and sign up for a free account (GitHub login recommended).
2. Click **Create Project**.
3. Name your project: `balanceguard-core`.
4. Choose the region closest to you (e.g., `AWS ap-southeast-1` Singapore, `eu-central-1` Frankfurt, or `us-east-1` N. Virginia).
5. Click **Create Project**.

### Step 1.2: Set Up `main` and `dev` Branches
1. By default, Neon creates a branch named `main` or `production`. This will be your **production** database.
2. In the left sidebar of your Neon console, click **Branches**.
3. Click **New Branch** in the top-right.
4. Name the new branch: `dev`.
5. Set **Parent branch** to `main`.
6. Click **Create Branch**.

> [!NOTE]
> **Why two branches?**
> In real engineering teams, development never happens against the production database. Neon allows you to develop locally against `dev` without risking production data or schema corruption.

### Step 1.3: Copy the DIRECT Connection String
1. On the Neon Dashboard, make sure the branch selector at the top is set to **`dev`**.
2. Look at the **Connection Details** widget.
3. **CRITICAL**: Make sure the toggle **Pooled connection** is turned **OFF**.
   - **Why Direct (non-pooled)?** BalanceGuard Core uses PostgreSQL Advisory Locks (`pg_advisory_lock`) to coordinate schema migrations safely across distributed instances. Connection poolers (like PgBouncer) operate at the transaction level and can break session-level advisory locks.
4. Ensure the dropdown is set to **Postgres** (or **Node.js**).
5. Copy the connection string. It will look like:
   ```text
   postgresql://<username>:<password>@ep-silent-hill-123456.ap-southeast-1.neon.tech/neondb?sslmode=require
   ```
6. Open your local `backend/.env` file and set:
   ```env
   DATABASE_URL=postgresql://<username>:<password>@ep-silent-hill-123456.ap-southeast-1.neon.tech/neondb?sslmode=require
   ```

---

## 2. Redis Cloud Setup (Free Tier 30 MB)

We use Redis for BullMQ background job processing (async LLM explanations, webhooks, reconciliation) and 10-minute velocity rate-checks.

### Step 2.1: Create Your Free Redis Cloud Database
1. Go to [https://redis.io/try-free](https://redis.io/try-free) (or [https://app.redislabs.com](https://app.redislabs.com)) and sign up for a free account.
2. Under **Subscriptions**, click **New Subscription**.
3. Select the **Fixed / Free 30MB** plan.
4. Select a cloud provider and region close to your Neon database (e.g., AWS `us-east-1` or `ap-southeast-1`).
5. Name the database: `balanceguard-redis`.
6. Click **Create**.

### Step 2.2: Retrieve Endpoint and Credentials
1. Click on your newly created database.
2. In the **General** tab, find the **Public endpoint** (format: `redis-12345.c123.region.redns.redis-cloud.com:12345`).
3. Scroll down to **Security** and click the eye icon to view the **Default user password**.
4. Construct your `REDIS_URL`:
   - If TLS is NOT checked:
     ```text
     redis://default:<YOUR_PASSWORD>@<PUBLIC_ENDPOINT>
     ```
   - If TLS IS enabled:
     ```text
     rediss://default:<YOUR_PASSWORD>@<PUBLIC_ENDPOINT>
     ```
   *(Note the double `s` in `rediss://` for TLS).*

### Step 2.3: Set Eviction Policy to `noeviction`
1. In your Redis Cloud database dashboard, navigate to **Configuration** (or click **Edit database**).
2. Look for **Data Persistence & Eviction** (or **Eviction Policy**).
3. Change the Eviction Policy dropdown from `volatile-lru` or `allkeys-lru` to **`noeviction`**.
4. Click **Save** or **Apply changes**.

> [!IMPORTANT]
> **Why `noeviction` is strictly mandatory for BullMQ:**
> BullMQ relies on Redis data structures (Streams, Hashes, ZSets) to orchestrate state machines, distributed locks, and retry queues. If Redis runs low on memory and evicts a lock key or a job payload under an `lru` policy, BullMQ can drop jobs, duplicate transactions, or deadlock workers. With `noeviction`, Redis throws an error instead of silently losing transactional queue state.

### Step 2.4: Set Redis Environment Variables
In your local `backend/.env`, set:
```env
REDIS_URL=redis://default:<PASSWORD>@<HOST>:<PORT>
REDIS_KEY_PREFIX=bgc-dev
```

---

## 3. Google AI Studio Setup (Gemini API)

BalanceGuard Core uses Google Gemini to generate natural-language explanations for transactions flagged by the deterministic risk engine.

### Step 3.1: Generate an API Key
1. Go to [https://aistudio.google.com](https://aistudio.google.com).
2. Sign in with your Google account.
3. In the left navigation bar, click **Get API key**.
4. Click **Create API key** (you can create it in a new project or an existing Google Cloud project).
5. Copy the generated key.

> [!WARNING]
> **Privacy note:**
> On the free tier of Google AI Studio, prompt data may be processed for service improvement. BalanceGuard Core never sends personal data (names, emails, card numbers, or raw account numbers) to Gemini. Only anonymized, aggregated heuristic signals are evaluated (e.g. `{"amount_ratio": 3.4, "velocity_10m": 5, "off_hours": true}`).

### Step 3.2: Configure Gemini in `.env`
In your `backend/.env`:
```env
GEMINI_API_KEY=AIzaSy...your-actual-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
```
Pick a current free Flash model shown in AI Studio (default: `gemini-3.1-flash-lite`). If the model name stops working, the app falls back to template text.

---

## 4. Create `backend/.env`

Copy the template and fill it in:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The comments in `backend/.env.example` explain every variable:

- `DATABASE_URL`: the direct connection string of the Neon `dev` branch
- `DATABASE_SSL_REJECT_UNAUTHORIZED`: whether to enforce CA chain validation (`true` for production, `false` for self-signed dev certs)
- `DATABASE_CA_CERT`: optional custom CA certificate PEM string or file path
- `REDIS_URL` and `REDIS_KEY_PREFIX=bgc-dev`
- `JWT_SECRET`, `WEBHOOK_SIGNING_SECRET`, `CRON_SECRET`: three different random strings (at least 32 characters in production)
- `DEMO_MODE=true` and `ALLOW_PRODUCTION_DEMO_MODE=false` (in production, `DEMO_MODE=true` will fail startup unless `ALLOW_PRODUCTION_DEMO_MODE=true`)
- `GEMINI_API_KEY`: from Google AI Studio (optional)
- `GEMINI_MODEL=gemini-3.1-flash-lite`
- `SEED_ADMIN_PASSWORD` and `SEED_REVIEWER_PASSWORD`: passwords you choose for the two staff roles (`admin` and `reviewer`)

The server refuses to start if a required value is missing or invalid, and logs the validation errors.

---

## 5. Verification Checklist

Before you run the app, check that:

- [ ] Neon project created with `main` and `dev` branches.
- [ ] Direct `DATABASE_URL` for the `dev` branch copied into `backend/.env`.
- [ ] Redis Cloud free database created, eviction policy changed to `noeviction`, and `REDIS_URL` copied into `backend/.env`.
- [ ] Google AI Studio API key generated and copied into `backend/.env` (`GEMINI_MODEL=gemini-3.1-flash-lite`).
- [ ] `backend/.env` exists and `git status` does not list it (it is in `.gitignore`).

Then run `npm run migrate --prefix backend`, `npm run seed --prefix backend` and `npm run dev --prefix backend` (see the README).


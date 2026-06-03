# CDM-Design-Risk-Mgmt

A **CDM Rolling Risk Register** for Principal Designers under CDM 2015 / L153. Auth-protected, multi-tenant, deployed on Render as a single Node service serving an Express API + the static front-end.

Architecture mirrors the AHS Workplace Inspection System (`inspections.archerhs.co.uk`) so the same operational playbook applies.

## What this is

The PD's design risk register tool — record, score, track and report on design risks across a project's lifecycle. Generates branded PDF and Excel exports for issue to designers and the PC. Brand kit per-tenant.

## Architecture

```
.
├── server.js              Express server — JWT cookies, mounts API + static
├── bootstrap.js           First-run admin user seeding
├── package.json           bcryptjs, jsonwebtoken, pg, express, cookie-parser
├── db/
│   ├── index.js           Postgres pool + migrate() + health check
│   └── schema.sql         Tables: tenants, users, app_state
├── middleware/
│   └── auth.js            JWT verification, attaches req.user
├── routes/
│   ├── auth.js            POST /login, /logout, /me, /change-password
│   ├── state.js           GET / POST /api/state — per-tenant JSONB blob
│   └── admin.js           Consultant-only tenant + user management
└── public/
    └── index.html         Frontend (the PD Risk Register app)
```

**Frontend wrapping**: the original CDM Risk Register HTML is intact at `public/index.html`. An auth wrapper added at the bottom of the file replaces the previous localStorage-only model with a hybrid:

- **Not signed in** → app works as before, data stays in browser localStorage
- **Signed in** → on page load, server state for the active tenant is fetched and written into localStorage before the app boots; every save (state, locks, brand) is also debounced-synced to the server

The wrapper exposes itself as `window.AHSAuth` for debugging.

## Auth model

- Email + password, `bcryptjs` for hashing, JWT in `httpOnly` `ahs_session` cookie (sameSite=lax, secure in production)
- Two roles:
  - `consultant` (you) — sees all tenants, can manage users and tenants via `/api/admin/*`
  - `client_user` — scoped to a single tenant
- One state blob per tenant, stored as JSONB in `app_state`
- Bootstrap creates the first consultant user from env vars on first boot

## Deployment

### Render — single Blueprint

This repo is set up to deploy as a Render **Web Service** + **Postgres** in one Blueprint apply. Add a `render.yaml` if you want fully declarative (see the `workplace-inspection-system` repo for a reference), or do it via the dashboard:

1. **dashboard.render.com → New + → PostgreSQL**
   - Name: `cdm-risk-register-db`
   - Plan: Starter (or whatever paid tier you're on)
   - Region: Frankfurt
2. **New + → Web Service** → connect this repo
   - Name: `cdm-risk-register`
   - Region: Frankfurt (must match the DB)
   - Build command: `npm install`
   - Start command: `node server.js`
   - Health check path: `/healthz`
3. **Environment** tab — add:
   - `DATABASE_URL` → from the linked Postgres (internal URL)
   - `SESSION_SECRET` → 48+ random bytes (generate via `openssl rand -base64 48`)
   - `ADMIN_EMAIL` → your login email
   - `ADMIN_PASSWORD` → strong 12+ char password (remove after first login)
   - `ADMIN_NAME` (optional)
   - `NODE_ENV=production`
4. First deploy runs migrations + seeds the admin user. Watch logs for `✓ CDM Risk Register listening on…`.
5. **Custom Domain** → set under Render service → Settings → Custom Domains. Add CNAME record in DNS.

### Local development

```bash
# 1. Install deps
npm install

# 2. Copy env template + fill in values
cp .env.example .env
# edit .env: set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, DATABASE_URL

# 3. Start a local Postgres (Docker is easiest)
docker run -d --name pg-cdm -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
# DATABASE_URL = postgresql://postgres:dev@localhost:5432/postgres

# 4. Run
npm run dev    # uses node --env-file=.env so .env is loaded automatically
# → http://localhost:3000
```

## Backups

The frontend keeps an export-to-JSON button (in the original app). Server-side, take Postgres backups via Render's snapshot feature or `pg_dump` on a schedule.

## Brand

AHS Compliance Consulting. Primary accent `#51a6a9`, dark accent `#408a8d`. Brand kit per-tenant is stored in the `BRAND_KEY` state slice and persists via the standard sync.

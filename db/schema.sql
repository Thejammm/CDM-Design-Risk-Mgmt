-- ══════════════════════════════════════════════════════════════
--  Workplace Inspection System — Database Schema
--  Run automatically on server startup. Idempotent.
-- ══════════════════════════════════════════════════════════════

-- Tenants: each client business is one tenant.
-- A consultant user has tenant_id NULL (sees all tenants).
CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT PRIMARY KEY,           -- e.g. 'easy-travel'
  name         TEXT NOT NULL,              -- display name e.g. 'Easy Travel Leeds'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users: anyone who can log in.
-- role = 'consultant' → can see/manage all tenants (Archer staff)
-- role = 'client_user' → scoped to one tenant
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id     TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  role          TEXT NOT NULL CHECK (role IN ('consultant', 'client_user')),
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email  ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);

-- App state: one row per tenant holding the entire S blob from the frontend.
-- Stored as JSONB so we can query inside it later if needed.
CREATE TABLE IF NOT EXISTS app_state (
  tenant_id   TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

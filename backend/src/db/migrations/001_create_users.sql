CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  azure_oid     VARCHAR(255) UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255),
  auth_provider VARCHAR(50)  NOT NULL DEFAULT 'local',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_azure_oid ON users (azure_oid);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users (email);

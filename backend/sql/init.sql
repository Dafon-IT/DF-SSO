-- DF-SSO Database Schema
-- PostgreSQL - SSO-v1, schema: public

-- 啟用 pgcrypto (for gen_random_uuid fallback)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- UUIDv7 生成函數
-- ============================================
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  ts_ms bigint;
  uuid_bytes bytea;
BEGIN
  ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
  uuid_bytes := decode(
    lpad(to_hex(ts_ms), 12, '0') ||
    encode(gen_random_bytes(10), 'hex'),
    'hex'
  );
  -- Set version 7
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & x'0F'::int) | x'70'::int);
  -- Set variant 10xx
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & x'3F'::int) | x'80'::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================
-- 自動更新 updated_at 觸發器函數
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- sso_login_log - 登入紀錄
-- ============================================
CREATE TABLE IF NOT EXISTS sso_login_log (
  ppid        SERIAL PRIMARY KEY,
  uid         UUID NOT NULL DEFAULT uuidv7(),

  -- Microsoft AD 回傳資料
  azure_oid           VARCHAR(255),
  email               VARCHAR(255),
  name                VARCHAR(255),
  preferred_username  VARCHAR(255),

  -- ERP 資料
  erp_gen01   VARCHAR(50),   -- 員工編號
  erp_gen02   VARCHAR(100),  -- 員工姓名
  erp_gen03   VARCHAR(50),   -- 部門代碼
  erp_gem02   VARCHAR(100),  -- 部門名稱
  erp_gen06   VARCHAR(255),  -- ERP email

  -- 登入狀態
  status      VARCHAR(20) NOT NULL DEFAULT 'success',  -- success / failed / erp_not_found
  error_message TEXT,

  -- IP / User Agent
  ip_address  VARCHAR(45),
  user_agent  TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_login_log_email ON sso_login_log (email);
CREATE INDEX IF NOT EXISTS idx_sso_login_log_status ON sso_login_log (status);
CREATE INDEX IF NOT EXISTS idx_sso_login_log_created_at ON sso_login_log (created_at);
CREATE INDEX IF NOT EXISTS idx_sso_login_log_uid ON sso_login_log (uid);

CREATE TRIGGER trg_sso_login_log_updated_at
  BEFORE UPDATE ON sso_login_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- sso_allowed_list - 允許的白名單網域
-- ============================================
CREATE TABLE IF NOT EXISTS sso_allowed_list (
  ppid        SERIAL PRIMARY KEY,
  uid         UUID NOT NULL DEFAULT uuidv7(),

  domain      VARCHAR(255) NOT NULL,         -- 網域名稱 (e.g. https://crm.df-recycle.com.tw)
  name        VARCHAR(255),                  -- 系統名稱 (e.g. CRM 系統)
  env         VARCHAR(20) NOT NULL DEFAULT 'local',  -- 環境：production / test / local
  description TEXT,                          -- 說明

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_allowed_list_domain ON sso_allowed_list (domain) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_sso_allowed_list_uid ON sso_allowed_list (uid);

CREATE TRIGGER trg_sso_allowed_list_updated_at
  BEFORE UPDATE ON sso_allowed_list
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

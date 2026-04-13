-- DF-SSO Database Bootstrap
--
-- 此檔案只由 docker-compose 掛載到 postgres 容器的
-- /docker-entrypoint-initdb.d/ 作為「資料庫首次建立」的最小初始化。
--
-- 真正的 schema、trigger、seed 全部由 backend 啟動時跑的 node-pg-migrate 管理：
--   - Test / Dev 環境：backend/migrations/dev/
--   - Prod 環境     ：backend/migrations/prod/
--
-- 因此此處 **只啟用 extension**，其餘一律不做，避免與 migration 產生衝突。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

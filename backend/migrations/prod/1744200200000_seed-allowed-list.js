/**
 * Prod 白名單 seed — 只灌 SSO Management 自己
 *
 * SSO Backend 啟動時會驗證 FRONTEND_URL 必須在白名單中，否則管理員登入會失敗。
 * 其他 Client App（CRM / 倉儲 / 報修 ...）由管理員透過 Dashboard 新增。
 *
 * app_id / app_secret 由 uuidv7() 與 gen_random_bytes(32) 自動產生；
 * redirect_uris 預先放入 management frontend 自身 origin。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

const PROD_MANAGEMENT_ORIGIN = 'https://df-sso-management.apps.zerozero.tw';

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, description, app_secret, redirect_uris)
    VALUES (
      '${PROD_MANAGEMENT_ORIGIN}',
      'SSO Management',
      'DF-SSO 管理後台（Prod）',
      encode(gen_random_bytes(32), 'hex'),
      ARRAY['${PROD_MANAGEMENT_ORIGIN}']
    )
    ON CONFLICT DO NOTHING
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = () => {
  // management domain 為系統必要資料，不可刪除
};

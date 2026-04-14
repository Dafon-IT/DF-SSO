/**
 * 新增 sso_setting 通用設定表（Prod 對應）
 *
 * 與 dev/1744193800000_create-sso-setting.js 等價，另開時間戳在 prod baseline
 * 三筆 migration（1744200000000 ~ 1744200200000）之後。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('sso_setting', {
    ppid: { type: 'serial', primaryKey: true },
    key: { type: 'varchar(128)', notNull: true, unique: true },
    value: { type: 'jsonb', notNull: true },
    category: { type: 'varchar(64)', notNull: true, default: "'general'" },
    label: { type: 'varchar(255)' },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('sso_setting', 'category');

  pgm.createTrigger('sso_setting', 'trg_sso_setting_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'update_updated_at',
  });

  pgm.sql(`
    INSERT INTO sso_setting (key, value, category, label, description) VALUES
      ('rate_limit.global',   '{"windowMs":900000,"max":500}'::jsonb, 'rate_limit', '全域速率限制',         '所有請求的全域上限，防 DoS'),
      ('rate_limit.auth',     '{"windowMs":900000,"max":30}'::jsonb,  'rate_limit', 'Auth 端點速率限制',    '登入 / redirect / authorize 流程，防暴力登入'),
      ('rate_limit.session',  '{"windowMs":900000,"max":100}'::jsonb, 'rate_limit', 'Session 端點速率限制', '/me 與 POST /logout（Client App 高頻 server-to-server 呼叫）'),
      ('rate_limit.exchange', '{"windowMs":60000,"max":20}'::jsonb,   'rate_limit', 'SSO exchange 速率限制','防 auth code 猜測')
    ON CONFLICT (key) DO NOTHING
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('sso_setting');
};

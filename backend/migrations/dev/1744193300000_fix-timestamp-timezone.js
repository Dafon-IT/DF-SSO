/**
 * 修正時區問題：TIMESTAMP → TIMESTAMPTZ，消除雙重 +8 時差
 *
 * 問題：原本用 TIMESTAMP (without time zone) + NOW() AT TIME ZONE 'Asia/Taipei'
 *       存入的值已是台北時間，但 pg driver 當 UTC 解讀，導致前端再 +8 顯示錯誤
 *
 * 修正：改用 TIMESTAMPTZ + NOW()，讓 PostgreSQL 正確處理時區
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  // --- sso_login_log ---
  pgm.alterColumn('sso_login_log', 'created_at', {
    type: 'timestamptz',
    using: "created_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_login_log', 'updated_at', {
    type: 'timestamptz',
    using: "updated_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_login_log', 'created_at', {
    default: pgm.func('NOW()'),
  });
  pgm.alterColumn('sso_login_log', 'updated_at', {
    default: pgm.func('NOW()'),
  });

  // --- sso_allowed_list ---
  pgm.alterColumn('sso_allowed_list', 'created_at', {
    type: 'timestamptz',
    using: "created_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_allowed_list', 'updated_at', {
    type: 'timestamptz',
    using: "updated_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_allowed_list', 'created_at', {
    default: pgm.func('NOW()'),
  });
  pgm.alterColumn('sso_allowed_list', 'updated_at', {
    default: pgm.func('NOW()'),
  });

  // --- 修正 trigger function ---
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  // --- sso_login_log ---
  pgm.alterColumn('sso_login_log', 'created_at', {
    type: 'timestamp',
    using: "created_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_login_log', 'updated_at', {
    type: 'timestamp',
    using: "updated_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_login_log', 'created_at', {
    default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')"),
  });
  pgm.alterColumn('sso_login_log', 'updated_at', {
    default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')"),
  });

  // --- sso_allowed_list ---
  pgm.alterColumn('sso_allowed_list', 'created_at', {
    type: 'timestamp',
    using: "created_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_allowed_list', 'updated_at', {
    type: 'timestamp',
    using: "updated_at AT TIME ZONE 'Asia/Taipei'",
  });
  pgm.alterColumn('sso_allowed_list', 'created_at', {
    default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')"),
  });
  pgm.alterColumn('sso_allowed_list', 'updated_at', {
    default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')"),
  });

  // --- 還原 trigger function ---
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW() AT TIME ZONE 'Asia/Taipei';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
};

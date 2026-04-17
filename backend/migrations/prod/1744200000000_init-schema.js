/**
 * Prod baseline schema — DF-SSO v1
 *
 * 一次建立所有正式環境需要的物件：
 *   - pgcrypto extension
 *   - uuidv7() / update_updated_at() 函數
 *   - sso_login_log       登入紀錄
 *   - sso_allowed_list    OAuth2 Client 白名單（含 app_id / app_secret / redirect_uris）
 *   - sso_admin_manager   管理後台人員
 *
 * 所有 timestamp 欄位一律 TIMESTAMPTZ + NOW()（不再做 AT TIME ZONE 'Asia/Taipei' 換算）。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  // ============================================
  // Extensions & helper functions
  // ============================================
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  pgm.sql(`
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
      uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & x'0F'::int) | x'70'::int);
      uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & x'3F'::int) | x'80'::int);
      RETURN encode(uuid_bytes, 'hex')::uuid;
    END;
    $$ LANGUAGE plpgsql VOLATILE
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // ============================================
  // sso_login_log
  // ============================================
  pgm.createTable('sso_login_log', {
    ppid: { type: 'serial', primaryKey: true },
    uid: { type: 'uuid', notNull: true, default: pgm.func('uuidv7()') },
    azure_oid: { type: 'varchar(255)' },
    email: { type: 'varchar(255)' },
    name: { type: 'varchar(255)' },
    preferred_username: { type: 'varchar(255)' },
    erp_gen01: { type: 'varchar(50)' },
    erp_gen02: { type: 'varchar(100)' },
    erp_gen03: { type: 'varchar(50)' },
    erp_gem02: { type: 'varchar(100)' },
    erp_gen06: { type: 'varchar(255)' },
    status: { type: 'varchar(20)', notNull: true, default: "'success'" },
    error_message: { type: 'text' },
    ip_address: { type: 'varchar(45)' },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('sso_login_log', 'email');
  pgm.createIndex('sso_login_log', 'status');
  pgm.createIndex('sso_login_log', 'created_at');
  pgm.createIndex('sso_login_log', 'uid');

  pgm.createTrigger('sso_login_log', 'trg_sso_login_log_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'update_updated_at',
  });

  // ============================================
  // sso_allowed_list (含 OAuth2 Client Credentials)
  // ============================================
  pgm.createTable('sso_allowed_list', {
    ppid: { type: 'serial', primaryKey: true },
    uid: { type: 'uuid', notNull: true, default: pgm.func('uuidv7()') },
    domain: { type: 'varchar(255)', notNull: true },
    name: { type: 'varchar(255)' },
    description: { type: 'text' },
    app_id: { type: 'uuid', notNull: true, unique: true, default: pgm.func('uuidv7()') },
    app_secret: { type: 'varchar(64)', notNull: true },
    redirect_uris: { type: 'text[]', notNull: true, default: '{}' },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_deleted: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('sso_allowed_list', 'domain', {
    unique: true,
    where: 'is_deleted = FALSE',
  });
  pgm.createIndex('sso_allowed_list', 'uid');

  pgm.createTrigger('sso_allowed_list', 'trg_sso_allowed_list_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'update_updated_at',
  });

  // ============================================
  // sso_admin_manager
  // ============================================
  pgm.createTable('sso_admin_manager', {
    ppid: { type: 'serial', primaryKey: true },
    uid: { type: 'uuid', notNull: true, default: pgm.func('uuidv7()') },
    azure_oid: { type: 'varchar(255)' },
    email: { type: 'varchar(255)', notNull: true },
    name: { type: 'varchar(255)' },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_newer: { type: 'boolean', notNull: true, default: false },
    is_deleted: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('sso_admin_manager', 'email', {
    unique: true,
    where: 'is_deleted = FALSE',
  });
  pgm.createIndex('sso_admin_manager', 'uid');

  pgm.createTrigger('sso_admin_manager', 'trg_sso_admin_manager_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'update_updated_at',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('sso_admin_manager');
  pgm.dropTable('sso_allowed_list');
  pgm.dropTable('sso_login_log');
  pgm.sql('DROP FUNCTION IF EXISTS update_updated_at()');
  pgm.sql('DROP FUNCTION IF EXISTS uuidv7()');
};

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // pgcrypto extension
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // UUIDv7 function
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

  // updated_at trigger function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW() AT TIME ZONE 'Asia/Taipei';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // sso_login_log
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
    created_at: { type: 'timestamp', notNull: true, default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')") },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')") },
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

  // sso_allowed_list
  pgm.createTable('sso_allowed_list', {
    ppid: { type: 'serial', primaryKey: true },
    uid: { type: 'uuid', notNull: true, default: pgm.func('uuidv7()') },
    domain: { type: 'varchar(255)', notNull: true },
    name: { type: 'varchar(255)' },
    description: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_deleted: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')") },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func("(NOW() AT TIME ZONE 'Asia/Taipei')") },
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
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable('sso_allowed_list');
  pgm.dropTable('sso_login_log');
  pgm.sql('DROP FUNCTION IF EXISTS update_updated_at()');
  pgm.sql('DROP FUNCTION IF EXISTS uuidv7()');
};

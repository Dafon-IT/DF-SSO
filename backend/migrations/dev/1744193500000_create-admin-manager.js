/**
 * 建立 sso_admin_manager 管理員名單表
 * 僅有在此表中的人員才可登入 SSO 管理後台
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('sso_admin_manager', {
    ppid: { type: 'serial', primaryKey: true },
    uid: { type: 'uuid', notNull: true, default: pgm.func('uuidv7()') },
    azure_oid: { type: 'varchar(255)' },
    email: { type: 'varchar(255)', notNull: true },
    name: { type: 'varchar(255)' },
    is_active: { type: 'boolean', notNull: true, default: true },
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

  // 預設管理員
  pgm.sql(`
    INSERT INTO sso_admin_manager (azure_oid, email, name)
    VALUES ('c5e1e537-63f8-4331-a9d0-820ad6e086bb', 'jiaye.he@df-recycle.com', 'IT-Jiaye He 何佳曄')
    ON CONFLICT DO NOTHING
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('sso_admin_manager');
};

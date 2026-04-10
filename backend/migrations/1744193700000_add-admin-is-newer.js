/**
 * 新增 is_newer 欄位到 sso_admin_manager
 * is_newer = TRUE 表示新建立但尚未登入過的管理員（缺少 azure_oid / name）
 * 管理員首次登入後會自動填入 azure_oid、name 並設為 FALSE
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.addColumn('sso_admin_manager', {
    is_newer: { type: 'boolean', notNull: true, default: false },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('sso_admin_manager', 'is_newer');
};

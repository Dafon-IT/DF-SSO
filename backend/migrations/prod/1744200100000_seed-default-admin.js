/**
 * Prod 預設管理員 seed
 *
 * 至少需要一位初始管理員才能登入 Dashboard，後續新增 / 刪除 App 與管理員。
 * 首次登入時 Microsoft AD 會回傳 azure_oid / name，系統會自動填回並把 is_newer 設為 FALSE。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_admin_manager (azure_oid, email, name, is_active, is_newer)
    VALUES (
      'c5e1e537-63f8-4331-a9d0-820ad6e086bb',
      'jiaye.he@df-recycle.com',
      'IT-Jiaye He 何佳曄',
      TRUE,
      FALSE
    )
    ON CONFLICT DO NOTHING
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = () => {
  // 預設管理員為系統關鍵資料，不可刪除（避免部署回滾後無人能登入後台）
};

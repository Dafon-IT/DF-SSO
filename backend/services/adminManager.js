const db = require('../config/database');

/**
 * 檢查 email 是否為管理員（啟用中且未刪除）
 */
async function isAdmin(email) {
  const { rows } = await db.query(
    'SELECT 1 FROM sso_admin_manager WHERE email = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [email]
  );
  return rows.length > 0;
}

/**
 * 依 azure_oid 或 email 檢查是否為管理員
 */
async function isAdminByOidOrEmail(azureOid, email) {
  const { rows } = await db.query(
    'SELECT 1 FROM sso_admin_manager WHERE (azure_oid = $1 OR email = $2) AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [azureOid, email]
  );
  return rows.length > 0;
}

module.exports = { isAdmin, isAdminByOidOrEmail };

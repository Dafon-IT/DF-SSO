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

/**
 * 新進管理員首次登入：填入 azure_oid、name，將 is_newer 設為 FALSE
 * 僅在 is_newer = TRUE 時觸發
 */
async function activateIfNewer(azureOid, email, name) {
  const { rowCount } = await db.query(
    `UPDATE sso_admin_manager
     SET azure_oid = $1, name = $2, is_newer = FALSE
     WHERE email = $3 AND is_newer = TRUE AND is_active = TRUE AND is_deleted = FALSE`,
    [azureOid, name, email]
  );
  return rowCount > 0;
}

// ============================================
// CRUD
// ============================================

/**
 * 取得所有管理員（含停用的，排除已刪除的）
 */
async function findAll() {
  const { rows } = await db.query(
    'SELECT ppid, uid, azure_oid, email, name, is_active, is_newer, is_deleted, created_at, updated_at FROM sso_admin_manager WHERE is_deleted = FALSE ORDER BY created_at ASC'
  );
  return rows;
}

/**
 * 依 uid 取得單筆
 */
async function findByUid(uid) {
  const { rows } = await db.query(
    'SELECT ppid, uid, azure_oid, email, name, is_active, is_newer, is_deleted, created_at, updated_at FROM sso_admin_manager WHERE uid = $1 AND is_deleted = FALSE',
    [uid]
  );
  return rows[0] || null;
}

/**
 * 新增管理員（僅需 email，azure_oid / name 會在首次登入時自動填入）
 */
async function create({ email }) {
  const { rows } = await db.query(
    `INSERT INTO sso_admin_manager (email, is_newer)
     VALUES ($1, TRUE)
     RETURNING ppid, uid, azure_oid, email, name, is_active, is_newer, created_at, updated_at`,
    [email]
  );
  return rows[0];
}

/**
 * 更新管理員（支援部分更新：email, is_active）
 */
async function update(uid, { email, isActive }) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (email !== undefined) {
    fields.push(`email = $${paramIndex++}`);
    params.push(email);
  }
  if (isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(isActive);
  }

  if (fields.length === 0) return findByUid(uid);

  params.push(uid);
  const { rows } = await db.query(
    `UPDATE sso_admin_manager SET ${fields.join(', ')} WHERE uid = $${paramIndex} AND is_deleted = FALSE
     RETURNING ppid, uid, azure_oid, email, name, is_active, is_newer, created_at, updated_at`,
    params
  );
  return rows[0] || null;
}

/**
 * 軟刪除管理員
 */
async function remove(uid) {
  const { rows } = await db.query(
    `UPDATE sso_admin_manager SET is_deleted = TRUE, is_active = FALSE WHERE uid = $1 AND is_deleted = FALSE
     RETURNING ppid, uid, azure_oid, email, name, is_active, is_newer, created_at, updated_at`,
    [uid]
  );
  return rows[0] || null;
}

module.exports = { isAdmin, isAdminByOidOrEmail, activateIfNewer, findAll, findByUid, create, update, remove };

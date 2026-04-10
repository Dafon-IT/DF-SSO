const db = require('../config/database');

/**
 * 取得所有未刪除的���名單
 */
async function findAll({ includeInactive = false } = {}) {
  const condition = includeInactive
    ? 'WHERE is_deleted = FALSE'
    : 'WHERE is_deleted = FALSE AND is_active = TRUE';
  const { rows } = await db.query(
    `SELECT * FROM sso_allowed_list ${condition} ORDER BY created_at DESC`
  );
  return rows;
}

/**
 * 依 uid 取得單筆
 */
async function findByUid(uid) {
  const { rows } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE uid = $1 AND is_deleted = FALSE',
    [uid]
  );
  return rows[0] || null;
}

/**
 * 依 name 取得單筆（啟用中）
 */
async function findByName(name) {
  const { rows } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE name = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [name]
  );
  return rows[0] || null;
}

/**
 * 新增白名單
 * 若 domain 已存在且 is_deleted = TRUE，則恢復該筆資��
 */
async function create({ domain, name, description }) {
  // 檢查是否已存在但被軟刪除的資料
  const { rows: deleted } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE domain = $1 AND is_deleted = TRUE',
    [domain]
  );

  if (deleted.length > 0) {
    const { rows } = await db.query(
      `UPDATE sso_allowed_list
       SET is_deleted = FALSE, is_active = TRUE, name = $2, description = $3
       WHERE ppid = $1
       RETURNING *`,
      [deleted[0].ppid, name, description]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO sso_allowed_list (domain, name, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [domain, name, description]
  );
  return rows[0];
}

/**
 * 更新白名單
 */
async function update(uid, { domain, name, description, isActive }) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (domain !== undefined) {
    fields.push(`domain = $${paramIndex++}`);
    params.push(domain);
  }
  if (name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    params.push(name);
  }
  if (description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    params.push(description);
  }
  if (isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(isActive);
  }

  if (fields.length === 0) return findByUid(uid);

  params.push(uid);
  const { rows } = await db.query(
    `UPDATE sso_allowed_list SET ${fields.join(', ')} WHERE uid = $${paramIndex} AND is_deleted = FALSE RETURNING *`,
    params
  );
  return rows[0] || null;
}

/**
 * 軟刪除白名單
 */
async function remove(uid) {
  const { rows } = await db.query(
    `UPDATE sso_allowed_list SET is_deleted = TRUE, is_active = FALSE WHERE uid = $1 AND is_deleted = FALSE RETURNING *`,
    [uid]
  );
  return rows[0] || null;
}

/**
 * 檢查 domain 是否在白名單中且啟用
 */
async function isDomainAllowed(domain) {
  const { rows } = await db.query(
    'SELECT 1 FROM sso_allowed_list WHERE domain = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [domain]
  );
  return rows.length > 0;
}

module.exports = { findAll, findByUid, findByName, create, update, remove, isDomainAllowed };

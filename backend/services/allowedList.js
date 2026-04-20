import crypto from 'crypto';
import db from '../config/database.js';

/**
 * 從 row 中移除 app_secret，僅保留末 4 碼供辨識
 */
function stripSecret(row) {
  if (!row) return null;
  const { app_secret, ...safe } = row;
  return { ...safe, app_secret_last4: app_secret ? `****${app_secret.slice(-4)}` : null };
}

/**
 * 取得所有未刪除的白名單
 */
async function findAll({ includeInactive = false } = {}) {
  const condition = includeInactive
    ? 'WHERE is_deleted = FALSE'
    : 'WHERE is_deleted = FALSE AND is_active = TRUE';
  const { rows } = await db.query(
    `SELECT * FROM sso_allowed_list ${condition} ORDER BY created_at DESC`
  );
  return rows.map(stripSecret);
}

/**
 * 依 uid 取得單筆
 */
async function findByUid(uid) {
  const { rows } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE uid = $1 AND is_deleted = FALSE',
    [uid]
  );
  return stripSecret(rows[0]);
}

/**
 * 依 app_id 取得單筆（啟用中）
 */
async function findByAppId(appId) {
  const { rows } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE app_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [appId]
  );
  return rows[0] || null;
}

/**
 * 依 name 取得單筆（啟用中）— 保留向下相容
 */
async function findByName(name) {
  const { rows } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE name = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1',
    [name]
  );
  return rows[0] || null;
}

/**
 * 新增白名單（自動產生 app_id + app_secret）
 * 若 domain 已存在且 is_deleted = TRUE，則恢復該筆資料並重新產生 credentials
 */
async function create({ domain, name, description, redirectUris, frontendUrl, backendDocsUrl }) {
  const appSecret = crypto.randomBytes(32).toString('hex');
  const uris = redirectUris && redirectUris.length > 0 ? redirectUris : [domain];

  // 檢查是否已存在但被軟刪除的資料
  const { rows: deleted } = await db.query(
    'SELECT * FROM sso_allowed_list WHERE domain = $1 AND is_deleted = TRUE',
    [domain]
  );

  if (deleted.length > 0) {
    const { rows } = await db.query(
      `UPDATE sso_allowed_list
       SET is_deleted = FALSE, is_active = TRUE, name = $2, description = $3,
           app_secret = $4, redirect_uris = $5,
           frontend_url = $6, backend_docs_url = $7
       WHERE ppid = $1
       RETURNING *`,
      [deleted[0].ppid, name, description, appSecret, uris, frontendUrl ?? null, backendDocsUrl ?? null]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO sso_allowed_list (domain, name, description, app_secret, redirect_uris, frontend_url, backend_docs_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [domain, name, description, appSecret, uris, frontendUrl ?? null, backendDocsUrl ?? null]
  );
  return rows[0];
}

/**
 * 更新白名單
 */
async function update(uid, { domain, name, description, isActive, redirectUris, frontendUrl, backendDocsUrl }) {
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
  if (redirectUris !== undefined) {
    fields.push(`redirect_uris = $${paramIndex++}`);
    params.push(redirectUris);
  }
  if (frontendUrl !== undefined) {
    fields.push(`frontend_url = $${paramIndex++}`);
    params.push(frontendUrl || null);
  }
  if (backendDocsUrl !== undefined) {
    fields.push(`backend_docs_url = $${paramIndex++}`);
    params.push(backendDocsUrl || null);
  }

  if (fields.length === 0) return findByUid(uid);

  params.push(uid);
  const { rows } = await db.query(
    `UPDATE sso_allowed_list SET ${fields.join(', ')} WHERE uid = $${paramIndex} AND is_deleted = FALSE RETURNING *`,
    params
  );
  return stripSecret(rows[0]);
}

/**
 * 重新產生 app_secret
 */
async function regenerateSecret(uid) {
  const newSecret = crypto.randomBytes(32).toString('hex');
  const { rows } = await db.query(
    'UPDATE sso_allowed_list SET app_secret = $1 WHERE uid = $2 AND is_deleted = FALSE RETURNING *',
    [newSecret, uid]
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
  return stripSecret(rows[0]);
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

/**
 * 取得所有已註冊的 redirect_uri origins（用於 CORS + back-channel）
 */
async function getAllOrigins() {
  const { rows } = await db.query(
    'SELECT redirect_uris FROM sso_allowed_list WHERE is_active = TRUE AND is_deleted = FALSE'
  );
  const origins = new Set();
  for (const row of rows) {
    if (row.redirect_uris) {
      for (const uri of row.redirect_uris) {
        origins.add(uri);
      }
    }
  }
  return [...origins];
}

/**
 * 取得所有已註冊 App 的 origin + secret（用於 back-channel HMAC 簽章）
 */
async function getAllAppsForBackChannel() {
  const { rows } = await db.query(
    'SELECT app_secret, redirect_uris FROM sso_allowed_list WHERE is_active = TRUE AND is_deleted = FALSE'
  );
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.redirect_uris) {
      for (const uri of row.redirect_uris) {
        if (!seen.has(uri)) {
          seen.add(uri);
          result.push({ origin: uri, appSecret: row.app_secret });
        }
      }
    }
  }
  return result;
}

export default {
  findAll, findByUid, findByAppId, findByName,
  create, update, regenerateSecret, remove,
  isDomainAllowed, getAllOrigins, getAllAppsForBackChannel,
};

import db from '../config/database.js';

/**
 * 新增登入紀錄
 */
async function create({ azureOid, email, name, preferredUsername, erpData, status, errorMessage, ipAddress, userAgent }) {
  const { rows } = await db.query(
    `INSERT INTO sso_login_log
      (azure_oid, email, name, preferred_username, erp_gen01, erp_gen02, erp_gen03, erp_gem02, erp_gen06, status, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      azureOid,
      email,
      name,
      preferredUsername,
      erpData?.gen01 || null,
      erpData?.gen02 || null,
      erpData?.gen03 || null,
      erpData?.gem02 || null,
      erpData?.gen06 || null,
      status,
      errorMessage || null,
      ipAddress || null,
      userAgent || null,
    ]
  );
  return rows[0];
}

/**
 * 搜尋登入紀錄（支援日期範圍、狀態、email 篩選、分頁）
 */
async function search({ email, status, startDate, endDate, page = 1, pageSize = 20 } = {}) {
  // 限制 pageSize 上限，防止 DoS
  pageSize = Math.min(Math.max(1, pageSize), 100);
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (email) {
    conditions.push(`email ILIKE $${paramIndex++}`);
    params.push(`%${email}%`);
  }

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM sso_login_log ${where}`,
    params
  );

  const { rows } = await db.query(
    `SELECT * FROM sso_login_log ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, pageSize, offset]
  );

  return {
    data: rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    pageSize,
    totalPages: Math.ceil(parseInt(countResult.rows[0].total, 10) / pageSize),
  };
}

export default { create, search };

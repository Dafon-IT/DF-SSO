const db = require('../config/database');

async function findAll() {
  const { rows } = await db.query(
    'SELECT ppid, key, value, category, label, description, created_at, updated_at FROM sso_setting ORDER BY category, key'
  );
  return rows;
}

async function findByCategory(category) {
  const { rows } = await db.query(
    'SELECT ppid, key, value, category, label, description, created_at, updated_at FROM sso_setting WHERE category = $1 ORDER BY key',
    [category]
  );
  return rows;
}

async function findByKey(key) {
  const { rows } = await db.query(
    'SELECT ppid, key, value, category, label, description, created_at, updated_at FROM sso_setting WHERE key = $1',
    [key]
  );
  return rows[0] || null;
}

async function updateValueByKey(key, value) {
  const { rows } = await db.query(
    'UPDATE sso_setting SET value = $2 WHERE key = $1 RETURNING ppid, key, value, category, label, description, created_at, updated_at',
    [key, value]
  );
  return rows[0] || null;
}

/**
 * 將某個 category 的 rows 轉成 { [key]: value } map，方便呼叫端查表
 */
async function getMapByCategory(category) {
  const rows = await findByCategory(category);
  const map = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

module.exports = {
  findAll,
  findByCategory,
  findByKey,
  updateValueByKey,
  getMapByCategory,
};

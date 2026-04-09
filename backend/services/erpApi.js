const config = require('../config');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * 取得 ERP API JWT Token（帶快取）
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(config.erp.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.erp.account,
      password: config.erp.password,
    }),
  });

  if (!res.ok) {
    throw new Error(`ERP login failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.token || data.access_token;
  // 快取 3 小時
  tokenExpiresAt = Date.now() + 3 * 60 * 60 * 1000;
  return cachedToken;
}

/**
 * 根據 email 搜尋 ERP 員工資料
 * ERP API 是模糊查詢，需篩選 email 完全一致的結果
 */
async function searchByEmail(email) {
  const token = await getToken();

  const res = await fetch(config.erp.searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ gen06: email }),
  });

  if (!res.ok) {
    throw new Error(`ERP search failed: ${res.status}`);
  }

  const result = await res.json();

  if (!result.success || !Array.isArray(result.data)) {
    return null;
  }

  // 篩選 email 完全一致的資料
  const matched = result.data.find(
    (item) => item.gen06 && item.gen06.toLowerCase() === email.toLowerCase()
  );

  return matched || null;
}

module.exports = { searchByEmail };

# 安全性要求

實作 Microsoft AD 登入時必須遵守的安全性要求。

## 1. State 參數（CSRF 防護）

### 為什麼需要

State 參數用於防止 CSRF（Cross-Site Request Forgery）攻擊。攻擊者可能誘騙使用者點擊惡意連結，將攻擊者的帳號綁定到受害者的 session。

### 實作方式

```javascript
const crypto = require('crypto');

// 產生 state
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// 登入端點
router.get('/microsoft/login', (req, res) => {
  const state = generateState();
  req.session.oauthState = state; // 存入 session
  
  const authUrl = await cca.getAuthCodeUrl({
    scopes: ['openid', 'profile', 'email'],
    redirectUri: process.env.AZURE_REDIRECT_URI,
    state: state
  });
  
  res.redirect(authUrl);
});

// 回調端點
router.get('/microsoft/redirect', (req, res) => {
  const { state, code } = req.query;
  
  // 驗證 state
  if (state !== req.session.oauthState) {
    return res.status(403).send('Invalid state parameter');
  }
  
  // 清除已使用的 state
  delete req.session.oauthState;
  
  // 繼續處理...
});
```

## 2. id_token 驗證

### 驗證項目

| 項目 | 說明 |
|------|------|
| 簽章 | 使用 Microsoft 公鑰驗證 JWT 簽章 |
| `aud` | 必須等於你的 Client ID |
| `iss` | 必須是 Microsoft 的 issuer URL |
| `exp` | Token 未過期 |
| `iat` | Token 發行時間合理 |

### 使用 MSAL 自動驗證

MSAL 套件會自動驗證 id_token，建議使用 `acquireTokenByCode` 方法：

```javascript
const tokenResponse = await cca.acquireTokenByCode({
  code: req.query.code,
  scopes: ['openid', 'profile', 'email'],
  redirectUri: process.env.AZURE_REDIRECT_URI
});

// tokenResponse.idTokenClaims 已經過驗證
const claims = tokenResponse.idTokenClaims;
```

## 3. Client Secret 保護

### 必須遵守

- ❌ 不要將 Client Secret 寫入程式碼
- ❌ 不要將 `.env` 檔案提交到版本控制
- ❌ 不要在前端程式碼中使用 Client Secret
- ✅ 使用環境變數存放敏感資訊
- ✅ 在 `.gitignore` 中排除 `.env`
- ✅ 定期更換 Client Secret

### .gitignore 設定

```gitignore
.env
.env.local
.env.*.local
```

## 4. 使用者對應

### 建議做法

1. **首選：使用 oid（Object ID）**
   - Azure AD 中的唯一識別碼
   - 即使 email 變更也不會改變

2. **備選：使用 email**
   - 較直觀
   - 但使用者可能變更 email

### 實作範例

```javascript
async function findOrCreateUser(claims) {
  const { oid, email, name } = claims;
  
  // 優先用 oid 查詢
  let user = await User.findOne({ azureOid: oid });
  
  if (!user) {
    // 嘗試用 email 查詢現有使用者
    user = await User.findOne({ email: email });
    
    if (user) {
      // 綁定 Azure AD
      user.azureOid = oid;
      await user.save();
    } else {
      // 建立新使用者
      user = await User.create({
        azureOid: oid,
        email: email,
        name: name,
        authProvider: 'microsoft'
      });
    }
  }
  
  return user;
}
```

## 5. 錯誤處理

### 需處理的錯誤情況

| 錯誤 | 處理方式 |
|------|----------|
| State 驗證失敗 | 返回 403，記錄可能的攻擊 |
| Token 交換失敗 | 返回 500，記錄錯誤詳情 |
| id_token 驗證失敗 | 返回 401，記錄錯誤 |
| 使用者建立失敗 | 返回 500，記錄錯誤 |

### 日誌記錄

```javascript
router.get('/microsoft/redirect', async (req, res) => {
  try {
    // ... 處理邏輯
  } catch (error) {
    console.error('Microsoft OAuth Error:', {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
      // 不要記錄敏感資訊如 tokens
    });
    
    res.redirect('/login?error=oauth_failed');
  }
});
```

## 6. HTTPS 要求

- 正式環境必須使用 HTTPS
- Redirect URI 必須是 HTTPS（本機開發除外）
- 所有 Token 傳輸必須加密

## 安全性檢查清單

- [ ] State 參數已實作且正確驗證
- [ ] id_token 簽章已驗證
- [ ] Client Secret 未暴露在程式碼中
- [ ] .env 已加入 .gitignore
- [ ] 使用者對應邏輯正確
- [ ] 錯誤處理完善且有日誌
- [ ] 正式環境使用 HTTPS

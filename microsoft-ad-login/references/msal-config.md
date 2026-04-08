# MSAL 設定參考

Microsoft Authentication Library (MSAL) for Node.js 的設定說明。

## 安裝

```bash
npm install @azure/msal-node
```

## 基本設定

```javascript
const msal = require('@azure/msal-node');

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        if (!containsPii) {
          console.log(message);
        }
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Info,
    }
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);
```

## 設定項目說明

### auth

| 屬性 | 說明 | 必填 |
|------|------|------|
| `clientId` | Azure AD 應用程式 ID | ✅ |
| `authority` | 認證端點 URL | ✅ |
| `clientSecret` | 用戶端密碼 | ✅ |

### authority 格式

| 租用戶類型 | Authority URL |
|------------|---------------|
| 單一租用戶 | `https://login.microsoftonline.com/{tenant-id}` |
| 多租用戶 | `https://login.microsoftonline.com/common` |
| 僅個人帳戶 | `https://login.microsoftonline.com/consumers` |
| 組織帳戶 | `https://login.microsoftonline.com/organizations` |

### system.loggerOptions

| 屬性 | 說明 | 建議值 |
|------|------|--------|
| `loggerCallback` | 日誌回調函數 | 自訂函數 |
| `piiLoggingEnabled` | 是否記錄個人資訊 | `false`（正式環境） |
| `logLevel` | 日誌等級 | `Info` 或 `Warning` |

## 常用方法

### getAuthCodeUrl - 取得授權 URL

```javascript
const authCodeUrlParameters = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  redirectUri: process.env.AZURE_REDIRECT_URI,
  state: 'random-state-string',
};

const authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
// 重導向使用者到 authUrl
```

### acquireTokenByCode - 用 code 換取 token

```javascript
const tokenRequest = {
  code: req.query.code,
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  redirectUri: process.env.AZURE_REDIRECT_URI,
};

const tokenResponse = await cca.acquireTokenByCode(tokenRequest);

// tokenResponse 結構
{
  authority: 'https://login.microsoftonline.com/...',
  uniqueId: 'user-unique-id',
  tenantId: 'tenant-id',
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  account: { /* 帳戶資訊 */ },
  idToken: 'eyJ...',
  idTokenClaims: {
    aud: 'client-id',
    iss: 'https://login.microsoftonline.com/.../v2.0',
    iat: 1234567890,
    exp: 1234571490,
    name: 'User Name',
    oid: 'object-id',
    preferred_username: 'user@domain.com',
    email: 'user@domain.com',
    // ...
  },
  accessToken: 'eyJ...',
  expiresOn: Date,
}
```

## Scopes 說明

| Scope | 說明 | 用途 |
|-------|------|------|
| `openid` | OpenID Connect 必要 | 取得 id_token |
| `profile` | 基本個人資料 | 取得 name 等 |
| `email` | Email 地址 | 取得使用者 email |
| `User.Read` | 讀取使用者資料 | 使用 Graph API 取得更多資訊 |

## 完整範例

```javascript
const express = require('express');
const msal = require('@azure/msal-node');
const router = express.Router();

// MSAL 設定
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// 登入端點
router.get('/microsoft/login', async (req, res) => {
  const state = require('crypto').randomBytes(32).toString('hex');
  req.session.oauthState = state;
  
  try {
    const authUrl = await cca.getAuthCodeUrl({
      scopes: ['openid', 'profile', 'email'],
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state: state,
    });
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error getting auth URL:', error);
    res.redirect('/login?error=auth_failed');
  }
});

// 回調端點
router.get('/microsoft/redirect', async (req, res) => {
  const { code, state } = req.query;
  
  // 驗證 state
  if (state !== req.session.oauthState) {
    return res.status(403).send('Invalid state');
  }
  delete req.session.oauthState;
  
  try {
    const tokenResponse = await cca.acquireTokenByCode({
      code: code,
      scopes: ['openid', 'profile', 'email'],
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });
    
    const claims = tokenResponse.idTokenClaims;
    // 處理使用者登入邏輯...
    
    res.redirect(process.env.ROPC_REDIRECT_URL || '/');
  } catch (error) {
    console.error('Error acquiring token:', error);
    res.redirect('/login?error=token_failed');
  }
});

module.exports = router;
```

## 常見問題

### Q: 如何處理 Token 過期？

A: 對於 SSO 登入，通常在登入時取得 id_token 後就發放系統自己的 JWT，不需要長期保存 Microsoft 的 token。

### Q: 如何取得更多使用者資訊？

A: 使用 access_token 呼叫 Microsoft Graph API：

```javascript
const response = await fetch('https://graph.microsoft.com/v1.0/me', {
  headers: {
    'Authorization': `Bearer ${tokenResponse.accessToken}`
  }
});
const userInfo = await response.json();
```

### Q: 多租用戶 vs 單一租用戶？

A: 
- **單一租用戶**：只允許特定組織的使用者登入
- **多租用戶**：允許任何 Azure AD 組織的使用者登入

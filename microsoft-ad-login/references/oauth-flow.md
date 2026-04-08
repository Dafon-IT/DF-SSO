# OAuth Authorization Code Flow

Microsoft AD 登入使用 OAuth 2.0 Authorization Code Flow。

## 流程圖

```
使用者點擊「使用 Microsoft 帳號登入」按鈕
        │
        ▼
┌───────────────────────────────────────────────┐
│  GET /api/auth/microsoft/login                │
│  - 產生 state 參數（防止 CSRF）                │
│  - 建構授權 URL                                │
│  - 重導向到 Microsoft                          │
└───────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│  Microsoft 登入頁面                            │
│  https://login.microsoftonline.com/{tenant}/  │
│  oauth2/v2.0/authorize                        │
│  - 使用者輸入帳號密碼                          │
│  - 同意應用程式權限                            │
└───────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│  Microsoft 回調                                │
│  GET /api/auth/microsoft/redirect             │
│  ?code=xxxxx&state=xxxxx                      │
└───────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│  後端處理                                      │
│  1. 驗證 state 參數                            │
│  2. 用 code 換取 tokens                        │
│     POST https://login.microsoftonline.com/   │
│     {tenant}/oauth2/v2.0/token                │
│  3. 驗證 id_token                              │
│  4. 取得使用者資訊 (email, name, oid)          │
└───────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│  系統處理                                      │
│  1. 查詢系統使用者（by email 或 oid）          │
│  2. 若不存在，建立新使用者                     │
│  3. 發放系統 JWT token                         │
│  4. 設定 cookie 或回傳 token                   │
└───────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│  重導向到首頁                                  │
│  Redirect to ROPC_REDIRECT_URL                │
└───────────────────────────────────────────────┘
```

## 關鍵 URL

### Authorization Endpoint

```
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
```

**Query Parameters:**
| 參數 | 說明 |
|------|------|
| `client_id` | 應用程式 ID |
| `response_type` | `code` |
| `redirect_uri` | 回調 URL（需 URL encode） |
| `scope` | `openid profile email User.Read` |
| `state` | 防 CSRF 的隨機字串 |

### Token Endpoint

```
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
```

**Request Body (POST):**
| 參數 | 說明 |
|------|------|
| `client_id` | 應用程式 ID |
| `client_secret` | 用戶端密碼 |
| `code` | 從授權端點取得的 code |
| `redirect_uri` | 回調 URL |
| `grant_type` | `authorization_code` |

### Token Response

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email User.Read",
  "id_token": "eyJ0eXAiOiJKV1QiLCJhbGciOi..."
}
```

## id_token 內容（解碼後）

```json
{
  "aud": "your-client-id",
  "iss": "https://login.microsoftonline.com/{tenant}/v2.0",
  "iat": 1234567890,
  "exp": 1234571490,
  "sub": "unique-user-id",
  "oid": "object-id-in-azure-ad",
  "preferred_username": "user@domain.com",
  "email": "user@domain.com",
  "name": "User Name"
}
```

## 重要欄位說明

| 欄位 | 說明 | 用途 |
|------|------|------|
| `oid` | Azure AD 中的物件 ID | 唯一識別使用者（推薦作為主鍵） |
| `email` | 使用者 Email | 可用於查詢現有使用者 |
| `name` | 顯示名稱 | 用於 UI 顯示 |
| `preferred_username` | 使用者名稱 | 通常與 email 相同 |

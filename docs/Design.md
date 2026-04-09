# DF-SSO 系統設計文件

## 目標

建立企業統一 SSO（Single Sign-On）單一登入系統：

1. 各子專案透過白名單授權，接入 SSO 中央驗證
2. **登入 App A → App B 自動登入**（中央 session 共享）
3. **登出 App A → 僅 App A 登出**，其他子專案與中央 session 不受影響
4. **SSO Dashboard 登出 → 所有子專案失效**（back-channel 通知）
5. 子專案整合只需 **5 個檔案 + 3 個環境變數**

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           使用者瀏覽器                                  │
└──────┬──────────────┬──────────────┬────────────────────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐
│ SSO Frontend │ │  App-A   │ │  App-B   │       ...更多子專案
│  (Next.js)   │ │(Next.js) │ │(Next.js) │
│  Port 3000   │ │Port 3100 │ │Port 3200 │
│              │ │          │ │          │
│ ‧管理後台    │ │ ‧自己的   │ │ ‧自己的   │
│ ‧白名單 CRUD │ │  登入頁   │ │  登入頁   │
│ ‧登入紀錄    │ │ ‧API routes│ │ ‧API routes│
└──────┬───────┘ └────┬─────┘ └────┬─────┘
       │              │            │
       │    ┌─────────┴────────────┘
       │    │  server-to-server
       ▼    ▼  (auth code exchange / Bearer token)
┌──────────────────────────────────┐
│    SSO Backend (Express.js)      │
│    Port 3001                     │
│                                  │
│  安全機制：                       │
│  ‧Helmet (安全 headers)          │
│  ‧Rate Limiting (防暴力攻擊)     │
│  ‧CORS 動態白名單 (從 DB 載入)   │
│  ‧重導向白名單驗證 (防 open redirect) │
│  ‧Auth Code 原子操作 (防 race condition) │
│  ‧環境變數啟動驗證               │
│  ‧Graceful Shutdown              │
│                                  │
│  /api/auth/{segment}/login       │ ← Microsoft OAuth 登入
│  /api/auth/{segment}/redirect    │ ← OAuth 回調
│  /api/auth/me                    │ ← 驗證（Cookie 或 Bearer）
│  /api/auth/logout                │ ← SSO Dashboard 登出
│  /api/auth/sso/authorize         │ ← 子專案授權入口
│  /api/auth/sso/exchange          │ ← auth code 交換 token
│  /api/auth/sso/logout            │ ← 全域登出 + back-channel
│  /api/allowed-list               │ ← 白名單 CRUD
│  /api/login-log                  │ ← 登入紀錄搜尋
└────┬────────┬─────────┬──────────┘
     │        │         │
┌────▼───┐ ┌──▼─────┐ ┌─▼──────────┐
│Microsoft│ │Postgre │ │   Redis    │
│Azure AD │ │  SQL   │ │  (DB 15)   │
│(OAuth)  │ │DB:SSO-v1│ │            │
└─────────┘ └────────┘ └────────────┘
                │
          ┌─────▼──────┐
          │  ERP API   │
          │ (員工資料)  │
          └────────────┘
```

---

## SSO 核心流程

### 子專案登入流程（以 App-A 為例）

```
使用者訪問 App-A → 呼叫本地 /api/auth/me → 無 token → 顯示登入頁
        │
        ▼  使用者點「透過 DF-SSO 登入」
[1] 瀏覽器導向 SSO Backend
    GET /api/auth/sso/authorize?app=App A&redirect_uri=http://localhost:3100/api/auth/callback
        │
        ▼
[2] SSO Backend 驗證
    - 用 app 參數查 sso_allowed_list.name → 找到記錄
    - 驗證 redirect_uri origin 與 domain 匹配
    - 檢查是否已有中央 session（JWT cookie + Redis）
        │
        ├─ 已有 session ──→ [5] 直接產生 auth code（免登入！）
        │
        ▼  無 session
[3] 重導向到 Microsoft 登入頁
    - 記住 ssoRedirect = redirect_uri
    - 使用者完成 Microsoft 認證
        │
        ▼
[4] OAuth 回調
    - 用 authorization code 換取 tokens
    - 查詢 ERP API 取得員工資料
    - 寫入 sso_login_log
    - 產生 JWT + 寫入 Redis Session
    - 設定 httpOnly cookie
        │
        ▼
[5] 產生一次性 Auth Code
    - 隨機 32 bytes hex，存入 Redis（TTL 60 秒）
    - 內含：userId, email, name, erpData
    - 重導向：redirect_uri?code=xxx
        │
        ▼
[6] App-A /api/auth/callback 接收 code
    - Server-to-server POST SSO /api/auth/sso/exchange { code }
    - SSO 使用 Lua script 原子性 GET+DEL（防止重複使用）
    - 回傳 { user, token }
    - App-A 將 token 存入 httpOnly cookie（sso_token）
    - 重導向到 /dashboard
        │
        ▼
[7] App-A Dashboard
    - 呼叫本地 /api/auth/me
    - 本地 API route：讀 sso_token → Bearer 轉發 SSO /api/auth/me
    - SSO 驗證 JWT + Redis Session → 回傳用戶資料
```

### 跨應用自動登入（SSO）

```
使用者已登入 App-A，訪問 App-B：

App-B → /api/auth/me → 無 sso_token → 顯示登入頁
  → 點登入 → SSO /authorize?app=App B&redirect_uri=...
  → SSO 檢查中央 session → 已登入 ✅
  → 直接產生 auth code（不碰 Microsoft 登入頁！）
  → App-B exchange → 存 token → Dashboard ✅
```

### 子專案登出（不影響其他 App）

```
App-A 點登出
  → /api/auth/logout → 清 App-A 的 sso_token → 回 App-A 首頁
  → SSO 中央 session 不受影響
  → App-B 仍然登入 ✅
  → App-A 重新登入 → SSO 有 session → 自動登入 ✅
```

### SSO Dashboard 全域登出

```
SSO Dashboard 點登出
  → SSO /api/auth/sso/logout
  → 刪除 Redis session + 清 cookie
  → Back-channel POST 所有子專案 /api/auth/back-channel-logout
  → 所有 App 下次 /me 呼叫 → SSO 回 401 → 回登入頁 ✅
```

---

## 安全機制

### 1. Helmet（安全 HTTP Headers）

自動設定：X-Content-Type-Options、X-Frame-Options、Strict-Transport-Security 等。

### 2. Rate Limiting

| 範圍 | 限制 | 說明 |
|------|------|------|
| 全域 | 500 次 / 15 分鐘 | 防止 DoS |
| Auth 端點 | 30 次 / 15 分鐘 | 防暴力登入 |
| Exchange 端點 | 20 次 / 1 分鐘 | 防 auth code 猜測 |

### 3. CORS 動態白名單

從 DB `sso_allowed_list` 動態載入允許的 origin（1 分鐘快取）。新增白名單即自動允許 CORS。

### 4. 重導向白名單驗證

所有 redirect 參數（authorize 的 `redirect_uri`、logout 的 `redirect`）都必須經過白名單驗證，防止開放重導向攻擊。

### 5. Auth Code 原子操作

使用 Redis Lua script 原子性 `GET + DEL`，防止同一 auth code 被重複使用（race condition）。

### 6. 環境變數啟動驗證

伺服器啟動時檢查所有必要環境變數（`SESSION_SECRET`、`JWT_SECRET`、Azure AD、DB），缺少則立即退出。

### 7. Graceful Shutdown

收到 `SIGTERM`/`SIGINT` 時優雅關閉：停止接受新連線 → 等待進行中請求完成 → 關閉 DB/Redis → 退出。

### 8. Body Size Limit

`express.json()` 限制 1MB，防止大 payload DoS。

### 9. Global Error Handler

- 未捕獲的 Promise rejection → 記錄日誌
- 未捕獲的 Exception → 記錄日誌 + 觸發 graceful shutdown
- 404 → JSON 回應
- CORS 錯誤 → 403 JSON 回應

---

## 資料庫設計

### sso_login_log（登入紀錄）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7 |
| `azure_oid` | VARCHAR(255) | Microsoft AD Object ID |
| `email` | VARCHAR(255) | 使用者 Email |
| `name` | VARCHAR(255) | 顯示名稱 |
| `preferred_username` | VARCHAR(255) | Microsoft 使用者名稱 |
| `erp_gen01` ~ `erp_gen06` | VARCHAR | ERP 員工資料 |
| `status` | VARCHAR(20) | `success` / `failed` / `erp_not_found` |
| `error_message` | TEXT | 錯誤訊息 |
| `ip_address` | VARCHAR(45) | 來源 IP |
| `user_agent` | TEXT | User Agent |
| `created_at` / `updated_at` | TIMESTAMP | UTC+8 |

**索引：** `email`, `status`, `created_at`, `uid`

### sso_allowed_list（白名單）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7 |
| `domain` | VARCHAR(255) | 網域（如 `https://asset.df-recycle.com.tw`） |
| `name` | VARCHAR(255) | App 識別名稱（如 `App A`），用於 authorize 的 `app` 參數 |
| `description` | TEXT | 說明 |
| `is_active` | BOOLEAN | 是否啟用 |
| `is_deleted` | BOOLEAN | 是否已刪除 |
| `created_at` / `updated_at` | TIMESTAMP | UTC+8 |

**索引：** `domain`（UNIQUE，`is_deleted = FALSE`）, `uid`

**白名單三重用途：**
1. **SSO 授權驗證** — authorize 用 `name` 查找 + 驗證 `redirect_uri` origin
2. **CORS 動態管理** — 從 DB 載入所有啟用的 `domain`
3. **重導向驗證** — logout redirect 必須在白名單 domain 內

---

## Redis 設計

### 中央 Session

```
Key:    sso:session:{userId}
TTL:    24 小時
Value:  { userId, email, name, erpData, loginLogUid, loginAt }
```

### 一次性 Auth Code

```
Key:    sso:code:{隨機 32 bytes hex}
TTL:    60 秒
Value:  { userId, email, name, erpData }
操作:   Lua script 原子性 GET+DEL（防重複使用）
```

---

## 後端 API

### Auth 認證

| Method | Path | Rate Limit | 說明 |
|--------|------|------------|------|
| GET | `/api/auth/{segment}/login` | 30/15min | Microsoft OAuth 登入 |
| GET | `/api/auth/{segment}/redirect` | 30/15min | OAuth 回調 |
| GET | `/api/auth/me` | 30/15min | 驗證（Cookie 或 Bearer header） |
| POST | `/api/auth/logout` | 30/15min | SSO Dashboard 登出 |

### SSO 跨應用

| Method | Path | Rate Limit | 說明 |
|--------|------|------------|------|
| GET | `/api/auth/sso/authorize` | 30/15min | 子專案授權（查白名單 → auth code 或 Microsoft 登入） |
| POST | `/api/auth/sso/exchange` | 20/1min | Auth code 交換 token（原子操作） |
| GET | `/api/auth/sso/logout` | 30/15min | 全域登出 + back-channel（redirect 驗證白名單） |

### 白名單 CRUD

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/allowed-list` | 取得所有（含 inactive） |
| POST | `/api/allowed-list` | 新增（自動恢復軟刪除） |
| PUT | `/api/allowed-list/:uid` | 更新 |
| DELETE | `/api/allowed-list/:uid` | 軟刪除 |

### 登入紀錄

| Method | Path | 參數 |
|--------|------|------|
| GET | `/api/login-log` | `email`, `status`, `startDate`, `endDate`, `page`, `pageSize` |

### Health Check

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | PostgreSQL + Redis 狀態（200 OK / 503 degraded） |

---

## 子專案整合指南

### 需要的檔案（5 個）

```
lib/sso.ts                              ← SSO token cookie 工具（35 行）
app/api/auth/callback/route.ts          ← 登入回調：exchange code → 存 token
app/api/auth/me/route.ts                ← 驗證：Bearer 轉發 SSO /me
app/api/auth/logout/route.ts            ← 登出：清本地 token → 回首頁
app/api/auth/back-channel-logout/route.ts ← 接收全域登出通知
```

### 環境變數

```env
# Server-side（API route 用）
SSO_URL=https://sso-api.df-recycle.com.tw
APP_URL=https://asset.df-recycle.com.tw
SESSION_SECRET=<隨機產生>

# Client-side（打包進 JS）
NEXT_PUBLIC_SSO_URL=https://sso-api.df-recycle.com.tw
NEXT_PUBLIC_APP_URL=https://asset.df-recycle.com.tw
NEXT_PUBLIC_APP_NAME=App A
```

### 前端整合

```tsx
// 登入
const handleLogin = () => {
  window.location.href = `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
};

// 驗證
fetch("/api/auth/me").then(res => res.ok ? res.json() : Promise.reject())
  .then(data => setUser(data.user))
  .catch(() => router.push("/"));

// 登出（僅清本地 token，不動中央 session）
window.location.href = "/api/auth/logout";
```

### 白名單設定

在 SSO Dashboard 新增：
- **網域：** `https://asset.df-recycle.com.tw`
- **名稱：** `App A`（與 `NEXT_PUBLIC_APP_NAME` 一致）
- **說明：** 資產管理系統

新增後 CORS 自動允許（最多 1 分鐘延遲）。

---

## 專案結構

```
DF-SSO/
├── backend/                          # SSO 中央伺服器 (Express, port 3001)
│   ├── config/
│   │   ├── database.js               # PostgreSQL 連線
│   │   ├── index.js                  # 環境變數集中管理 + 啟動驗證
│   │   ├── msal.js                   # Microsoft MSAL 設定
│   │   └── redis.js                  # Redis 連線
│   ├── routes/
│   │   ├── auth.js                   # Microsoft OAuth + /me + /logout
│   │   ├── sso.js                    # SSO 跨應用：authorize/exchange/logout
│   │   ├── allowedList.js            # 白名單 CRUD
│   │   └── loginLog.js              # 登入紀錄搜尋
│   ├── services/
│   │   ├── allowedList.js            # 白名單 DB（含 findByName）
│   │   ├── erpApi.js                 # ERP API 串接
│   │   └── loginLog.js              # 登入紀錄 DB
│   ├── migrations/                   # DB 遷移
│   ├── sql/init.sql                  # 完整 Schema
│   ├── server.js                     # Express（Helmet/RateLimit/CORS/Morgan/Graceful Shutdown）
│   └── .env.example
│
├── frontend/                         # SSO 管理後台 (Next.js, port 3000)
│   └── src/app/
│       ├── page.tsx                  # 管理員登入頁
│       └── dashboard/page.tsx        # 白名單管理 + 登入紀錄搜尋
│
├── app-a/                            # 範例子專案：資產管理系統 (port 3100)
│   ├── lib/sso.ts                    # SSO token cookie 工具
│   ├── app/
│   │   ├── api/auth/                 # SSO 整合 API routes
│   │   │   ├── callback/route.ts
│   │   │   ├── me/route.ts
│   │   │   ├── logout/route.ts
│   │   │   └── back-channel-logout/route.ts
│   │   ├── page.tsx                  # 登入頁
│   │   └── dashboard/page.tsx        # 資產管理 Dashboard
│   └── .env.local
│
├── app-b/                            # 範例子專案：報修系統 (port 3200)
│   └── ...                           # 同 app-a 結構
│
└── docs/Design.md                    # 本文件
```

---

## 環境變數

### SSO Backend（必填標記 ✱）

| 變數 | 說明 |
|------|------|
| `PORT` | 後端 Port（預設 3001） |
| `NODE_ENV` | `development` / `production` |
| `FRONTEND_URL` | SSO Frontend URL |
| ✱ `SESSION_SECRET` | Express Session 密鑰 |
| ✱ `JWT_SECRET` | JWT 簽名密鑰 |
| `JWT_EXPIRES_IN` | JWT 過期時間（預設 24h） |
| ✱ `AZURE_CLIENT_ID` | Azure AD Application ID |
| ✱ `AZURE_CLIENT_SECRET` | Azure AD Client Secret |
| ✱ `AZURE_TENANT_ID` | Azure AD Tenant ID |
| ✱ `AZURE_REDIRECT_URI` | OAuth Redirect URI |
| `ROPC_REDIRECT_URL` | Dashboard 登入後導向 |
| ✱ `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | PostgreSQL |
| `PG_HOST` / `PG_PORT` / `PG_SCHEMA` | PostgreSQL（有預設值） |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis（有預設值） |
| `ERP_API_LOGIN_URL` / `ERP_API_SEARCH_URL` | ERP API（選填） |
| `ERP_API_ACCOUNT` / `ERP_API_PASSWORD` | ERP API（選填） |

> **CORS 不需要環境變數**，從 DB 白名單自動載入。

### SSO Frontend

| 變數 | 說明 |
|------|------|
| `NEXT_PUBLIC_API_URL` | SSO Backend URL |
| `NEXT_PUBLIC_AUTH_PATH` | OAuth 路徑段 |

### 子專案

| 變數 | 說明 |
|------|------|
| `SSO_URL` | SSO Backend URL（server-side） |
| `APP_URL` | 本 App URL（server-side） |
| `SESSION_SECRET` | 本 App session 密鑰 |
| `NEXT_PUBLIC_SSO_URL` | SSO Backend URL（client-side） |
| `NEXT_PUBLIC_APP_URL` | 本 App URL（client-side） |
| `NEXT_PUBLIC_APP_NAME` | 對應白名單 `name` 欄位 |

---

## 部署注意事項

1. **Azure AD**：正式域名需加到 Azure Portal 的 Redirect URIs
2. **白名單 DB**：部署後更新 `sso_allowed_list` 為正式域名
3. **HTTPS**：`NODE_ENV=production` 時 cookie 自動啟用 `secure: true`
4. **NEXT_PUBLIC_**：這些是 build time 變數，需設在 CI/CD 的 build 環境
5. **密鑰**：所有 `SECRET` 變數必須使用隨機產生的強密鑰，不可共用

---

## 技術棧

| 層級 | 技術 |
|------|------|
| SSO Frontend | Next.js + TypeScript + Tailwind CSS |
| SSO Backend | Node.js + Express.js |
| 安全 | Helmet + express-rate-limit + CORS 動態白名單 |
| 日誌 | Morgan (request logging) |
| 認證 | Microsoft Azure AD (OAuth 2.0) |
| 資料庫 | PostgreSQL |
| Session / 快取 | Redis |
| Token | JWT (jsonwebtoken) |
| MSAL | @azure/msal-node |

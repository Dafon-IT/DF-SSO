# DF-SSO 系統設計文件

## 目標

1. 建立 `sso_login_log` 資料表，記錄所有使用者嘗試登入的紀錄
2. 建立 `sso_allowed_list` 資料表，記錄可允許的白名單網域資訊
3. 企業統一登入器系統，登入後，在所有的 `sso_allowed_list` 內部皆需可以直接登入
4. 根據 `ERP_API_LOGIN_URL`，須根據 `email` 查具體的資料

---

## 注意事項

1. 每個資料表皆須有 `ppid`(SERIAL), `uid`(UUIDv7), `created_at`(UTC+8), `updated_at`(UTC+8) 欄位
2. `sso_allowed_list` 需有 `is_deleted` 和 `is_active` 的設計
   - 如已刪除的資料, 使用者若再次新增, 則需要先檢查是否已存在但 `is_deleted = True` 的資料. 如果有, 則設為 `False`
3. 此 Frontend 僅需有針對 `sso_allowed_list` CRUD 以及查看 `sso_login_log` 的搜尋器
   - 搜尋器設計要有詳細的日期以及狀態控管
4. `sso_login_log` 需要記錄使用者 Microsoft Login Success 回傳的資料是誰
5. ERP API 為模糊查詢, 需要抓取根據 mail 完全一致的資料

---

## 系統架構

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Frontend   │────>│  Backend (API)   │────>│  Microsoft Azure   │
│  Next.js    │<────│  Express.js      │<────│  AD (OAuth 2.0)    │
│  Port 3000  │     │  Port 3001       │     └────────────────────┘
└─────────────┘     │                  │
                    │                  │────>┌────────────────────┐
                    │                  │<────│  ERP API           │
                    │                  │     │  Port 3333         │
                    │                  │     └────────────────────┘
                    │                  │
                    │                  │────>┌────────────────────┐
                    │                  │<────│  PostgreSQL        │
                    │                  │     │  DB: SSO-v1        │
                    │                  │     └────────────────────┘
                    │                  │
                    │                  │────>┌────────────────────┐
                    │                  │<────│  Redis (DB 15)     │
                    └──────────────────┘     └────────────────────┘
```

---

## 資料庫設計

### sso_login_log（登入紀錄）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7，唯一識別碼 |
| `azure_oid` | VARCHAR(255) | Microsoft AD Object ID |
| `email` | VARCHAR(255) | 使用者 Email |
| `name` | VARCHAR(255) | 使用者顯示名稱 |
| `preferred_username` | VARCHAR(255) | Microsoft 使用者名稱 |
| `erp_gen01` | VARCHAR(50) | ERP 員工編號 |
| `erp_gen02` | VARCHAR(100) | ERP 員工姓名 |
| `erp_gen03` | VARCHAR(50) | ERP 部門代碼 |
| `erp_gem02` | VARCHAR(100) | ERP 部門名稱 |
| `erp_gen06` | VARCHAR(255) | ERP Email |
| `status` | VARCHAR(20) | 登入狀態：`success` / `failed` / `erp_not_found` |
| `error_message` | TEXT | 錯誤訊息 |
| `ip_address` | VARCHAR(45) | 來源 IP |
| `user_agent` | TEXT | 瀏覽器 User Agent |
| `created_at` | TIMESTAMP | 建立時間 (UTC+8) |
| `updated_at` | TIMESTAMP | 更新時間 (UTC+8) |

**索引：** `email`, `status`, `created_at`, `uid`

### sso_allowed_list（白名單網域）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7，唯一識別碼 |
| `domain` | VARCHAR(255) | 網域名稱（如 `https://crm.df-recycle.com.tw`） |
| `name` | VARCHAR(255) | 系統名稱（如 CRM 系統） |
| `description` | TEXT | 說明 |
| `is_active` | BOOLEAN | 是否啟用（預設 TRUE） |
| `is_deleted` | BOOLEAN | 是否已刪除（預設 FALSE） |
| `created_at` | TIMESTAMP | 建立時間 (UTC+8) |
| `updated_at` | TIMESTAMP | 更新時間 (UTC+8) |

**索引：** `domain`（UNIQUE，僅 `is_deleted = FALSE`）, `uid`

**軟刪除邏輯：**
- 刪除時設定 `is_deleted = TRUE`, `is_active = FALSE`
- 新增時若 domain 已存在且 `is_deleted = TRUE`，則恢復該筆（設定 `is_deleted = FALSE`, `is_active = TRUE`）

---

## 登入流程

```
使用者點擊「使用 Microsoft 帳號登入」
        │
        ▼
[1] GET /api/auth/{隨機路徑}/login
    - 產生 state 參數（CSRF 防護）
    - 建構 Microsoft OAuth 授權 URL
    - 重導向到 Microsoft 登入頁
        │
        ▼
[2] Microsoft 登入頁面
    - 使用者輸入 Microsoft 帳號密碼
    - 授權同意
        │
        ▼
[3] GET /api/auth/{隨機路徑}/redirect
    - 驗證 state 參數
    - 用 authorization code 換取 tokens
    - 從 id_token 取得使用者資訊 (oid, email, name)
        │
        ▼
[4] 呼叫 ERP API 取得 Token
    - POST ERP_API_LOGIN_URL { username, password }
    - 取得 Bearer Token（快取 3 小時）
        │
        ▼
[5] 用 Token 查詢員工資料
    - POST ERP_API_SEARCH_URL { gen06: email }
    - 篩選 email 完全一致的結果
    - 取得 gen01(員工編號), gen02(姓名), gen03(部門代碼), gem02(部門名稱)
        │
        ▼
[6] 寫入 sso_login_log
    - 記錄 Microsoft AD 資料 + ERP 資料 + 登入狀態
    - 記錄 IP、User Agent
        │
        ▼
[7] 發放系統 JWT Token + 建立 Redis Session
    - 產生 JWT Token
    - 將使用者 Session 資料寫入 Redis（key: `sso:session:{uid}`）
      - 包含：userId, email, name, erpData, loginLogUid
      - 設定 TTL（與 JWT 過期時間一致，預設 24h）
    - 設定 httpOnly Cookie
    - 重導向到 Dashboard
```

---

## ERP API 串接

ERP API 需要兩步驟：先透過 `ERP_API_LOGIN_URL` 登入取得 Bearer Token，再用該 Token 呼叫 `ERP_API_SEARCH_URL` 查詢員工資料。

### Step 1：登入取得 Token

```
POST {ERP_API_LOGIN_URL}
Content-Type: application/json

{
  "username": "{ERP_API_ACCOUNT}",
  "password": "{ERP_API_PASSWORD}"
}
```

**環境變數對照（.env）：**
| 變數 | 範例值 | 說明 |
|------|--------|------|
| `ERP_API_LOGIN_URL` | `http://localhost:3333/api/auth/login` | ERP 登入端點 |
| `ERP_API_ACCOUNT` | `replit` | ERP 登入帳號 |
| `ERP_API_PASSWORD` | `1234` | ERP 登入密碼 |

**回傳：** JWT Token（後續 API 呼叫使用）

**Token 快取策略：** 取得後快取 3 小時，避免每次登入都重新取 Token。

### Step 2：查詢員工資料

使用 Step 1 取得的 Token，根據使用者登入的 email 查詢 ERP 員工資料。

```
POST {ERP_API_SEARCH_URL}
Authorization: Bearer {Step 1 取得的 Token}
Accept: application/json
Content-Type: application/json

{
  "gen06": "candy@df-recycle.com.tw"
}
```

**環境變數對照（.env）：**
| 變數 | 範例值 | 說明 |
|------|--------|------|
| `ERP_API_SEARCH_URL` | `http://localhost:3333/api/etl/employee/search` | ERP 員工搜尋端點 |

**回傳格式：**
```json
{
  "success": true,
  "data": [
    {
      "gen01": "00063",
      "gen02": "王雅祈",
      "gen03": "F000",
      "gem02": "財務部",
      "gen06": "candy@df-recycle.com.tw"
    },
    {
      "gen01": "S00063",
      "gen02": "賴仁祺",
      "gen03": "BB003",
      "gem02": "文山分選廠專案",
      "gen06": null
    }
  ]
}
```

**欄位對照：**
| ERP 欄位 | 說明 |
|----------|------|
| `gen01` | 員工編號 |
| `gen02` | 員工姓名 |
| `gen03` | 部門代碼 |
| `gem02` | 部門名稱 |
| `gen06` | Email |

**注意：** ERP API 為模糊查詢，回傳可能包含多筆結果，需篩選 `gen06` 與登入 email 完全一致（不分大小寫）的資料。若無匹配結果，登入紀錄狀態記為 `erp_not_found`。

---

## Redis Session 設計

登入成功後，使用者 Session 存入 Redis（DB 15），用於驗證登入狀態與快取使用者資料。

### Key 格式

```
sso:session:{userId}
```

### Value（JSON）

```json
{
  "userId": "azure-oid",
  "email": "user@df-recycle.com.tw",
  "name": "王雅祈",
  "erpData": {
    "gen01": "00063",
    "gen02": "王雅祈",
    "gen03": "F000",
    "gem02": "財務部",
    "gen06": "candy@df-recycle.com.tw"
  },
  "loginLogUid": "uuid-of-login-log-record",
  "loginAt": "2026-04-09T10:30:00+08:00"
}
```

### TTL

與 JWT 過期時間一致（預設 24 小時）。

### 驗證流程

1. 前端帶 Cookie（含 JWT Token）發送 API 請求
2. 後端驗證 JWT 有效性
3. 從 JWT 取得 `userId`，查詢 Redis `sso:session:{userId}`
4. 若 Redis Session 存在 → 驗證通過，回傳使用者資料
5. 若 Redis Session 不存在 → 回傳 401，前端導向登入頁

### 登出

1. 清除 Redis Session（`DEL sso:session:{userId}`）
2. 清除 Cookie

---

## 後端 API 設計

### Auth 認證

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/auth/{隨機路徑}/login` | 重導向到 Microsoft 登入 |
| GET | `/api/auth/{隨機路徑}/redirect` | OAuth callback，寫入登入紀錄 |
| GET | `/api/auth/me` | 取得目前登入使用者資訊 |
| POST | `/api/auth/logout` | 登出 |

### sso_allowed_list CRUD

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/allowed-list` | 取得所有白名單（含 inactive） |
| GET | `/api/allowed-list/:uid` | 取得單筆白名單 |
| POST | `/api/allowed-list` | 新增白名單（自動檢查軟刪除恢復） |
| PUT | `/api/allowed-list/:uid` | 更新白名單 |
| DELETE | `/api/allowed-list/:uid` | 軟刪除白名單 |

### sso_login_log 搜尋

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/login-log` | 搜尋登入紀錄 |

**搜尋參數：**
| 參數 | 型態 | 說明 |
|------|------|------|
| `email` | string | Email 模糊搜尋 |
| `status` | string | 狀態篩選：`success` / `failed` / `erp_not_found` |
| `startDate` | string | 開始日期 (YYYY-MM-DD) |
| `endDate` | string | 結束日期 (YYYY-MM-DD) |
| `page` | number | 頁碼（預設 1） |
| `pageSize` | number | 每頁筆數（預設 20） |

### Health Check

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | 檢查 PostgreSQL + Redis 連線狀態 |

---

## 前端頁面設計

### 首頁 `/`（登入頁）

- 僅顯示「使用 Microsoft 帳號登入」按鈕
- 無帳號密碼表單
- 顯示錯誤訊息（登入失敗、CSRF 驗證失敗等）

### Dashboard `/dashboard`

- 需登入後才能存取，未登入導向 `/`
- 兩個功能區塊：

#### 1. 白名單管理（sso_allowed_list）

- 列表顯示所有白名單（domain、名稱、狀態）
- 新增：輸入 domain、名稱、說明
- 編輯：修改 domain、名稱、說明、啟用/停用
- 刪除：軟刪除（確認對話框）

#### 2. 登入紀錄搜尋器（sso_login_log）

- 篩選條件：
  - Email（模糊搜尋）
  - 狀態（下拉選單：全部 / success / failed / erp_not_found）
  - 日期範圍（開始日期 ~ 結束日期）
- 表格欄位：時間、Email、姓名、員工編號、部門、狀態
- 分頁功能

---

## 環境變數

| 變數 | 說明 |
|------|------|
| `PORT` | 後端 Port（預設 3001） |
| `NODE_ENV` | 環境（development / production） |
| `FRONTEND_URL` | 前端 URL |
| `SESSION_SECRET` | Session 密鑰（隨機產生） |
| `JWT_SECRET` | JWT 密鑰（隨機產生） |
| `JWT_EXPIRES_IN` | JWT 過期時間（預設 24h） |
| `AZURE_CLIENT_ID` | Azure AD Application ID |
| `AZURE_CLIENT_SECRET` | Azure AD Client Secret |
| `AZURE_TENANT_ID` | Azure AD Tenant ID |
| `AZURE_REDIRECT_URI` | OAuth Redirect URI（路徑含隨機亂數） |
| `ROPC_REDIRECT_URL` | 登入成功後重導向路徑 |
| `PG_HOST` | PostgreSQL 主機 |
| `PG_PORT` | PostgreSQL Port |
| `PG_DATABASE` | PostgreSQL 資料庫名稱 |
| `PG_SCHEMA` | PostgreSQL Schema |
| `PG_USER` | PostgreSQL 帳號 |
| `PG_PASSWORD` | PostgreSQL 密碼 |
| `REDIS_HOST` | Redis 主機 |
| `REDIS_PORT` | Redis Port |
| `REDIS_DB` | Redis DB 編號 |
| `ERP_API_LOGIN_URL` | ERP API 登入端點 |
| `ERP_API_SEARCH_URL` | ERP API 員工搜尋端點 |
| `ERP_API_ACCOUNT` | ERP API 帳號 |
| `ERP_API_PASSWORD` | ERP API 密碼 |

---

## 技術棧

| 層級 | 技術 |
|------|------|
| Frontend | Next.js + TypeScript + Tailwind CSS |
| Backend | Node.js + Express.js |
| 認證 | Microsoft Azure AD (OAuth 2.0 Authorization Code Flow) |
| 資料庫 | PostgreSQL |
| Session / 快取 | Redis (DB 15)，管理使用者登入 Session |
| Token 管理 | JWT (jsonwebtoken) |
| MSAL | @azure/msal-node |

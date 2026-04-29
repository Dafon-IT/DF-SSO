# DF-SSO 整合指南

> 給接入 DF-SSO 的 Client App / AI Agent 使用。**本文件只描述契約與行為，不綁定任何語言或框架**。完整架構與安全細節請讀 [docs/Design.md](docs/Design.md)。

---

## 環境

| 環境 | Backend URL（Client 呼叫） | Dashboard |
|------|----------------------------|-----------|
| Prod | `https://df-it-sso-login.it.zerozero.tw` | `https://df-it-sso-management.it.zerozero.tw` |
| Test | `https://df-sso-login-test.apps.zerozero.tw` | `https://df-sso-management-test.apps.zerozero.tw` |
| Dev  | `http://localhost:3001` | `http://localhost:3000` |

每個環境**各自發放** credentials。同一 App 接多環境必須各到對應 Dashboard 拿一組 `app_id` + `app_secret`。`redirect_uris` 同一 App 可列多個 origin（最多 10），協定限 `http:` / `https:`。

---

## 硬性契約（漏一條就壞）

中央**無法強制驗證** Client 是否遵守，全靠自律：

1. **`/me` 即時回源中央** — 本地驗證端點必須以 `Authorization: Bearer <token>` 把每次請求轉發到中央 `/api/auth/me`。**JWT 簽名有效 ≠ session 仍存在**，中央 Redis 是唯一事實來源。**不可在本地快取 user**。
2. **登出 POST 中央 + 跟隨 redirect** — 收到本地 logout 請求時，必須先以 `Authorization: Bearer <token>` POST 中央 `/api/auth/logout`，然後 302 到回應中的 `redirect`。只清本地 cookie 不通知中央 → 中央 session 還活著，下次 silent SSO 把使用者拉回。
3. **登入頁 401 處理（兩種模式擇一，不可混用）** — 詳見下節「登入頁兩種模式」。**僅適用登入頁**；dashboard 在工作中遇到 401 兩個模式都走 silent re-auth（見後段）。
4. **Back-channel logout 必驗 HMAC + timestamp** — 演算法 `HMAC-SHA256`，訊息字串 `"${user_id}:${timestamp}"`，密鑰 `app_secret`；比對使用 constant-time 比對函式（**不可用 `==` / `equals`**），並驗 `abs(now_ms - timestamp) ≤ 30000`。**保留無驗證的端點 比 不註冊端點還糟**——前者騙系統有保護。

---

## 兩種整合模式

| 模式 | 適用 |
|------|------|
| **A. 純 SSO** | App 沒有自己的帳號系統，所有使用者透過 SSO 登入 |
| **B. 本地帳密 + SSO** | App 有自己的帳號表，部分使用者本地登入、部分走 SSO |

兩模式的硬性契約相同，差別在 **token 驗證策略** 與 **silent re-auth 行為**。

---

## 登入頁兩種模式（契約 #3 細則）

每個 App **必須**在「嚴格模式」與「企業 Portal 模式」之間明確擇一，兩個模式不可混用。決策依 App 性質：

| 模式 | 登入頁 401 行為 | 適用情境 | 取得 | 放棄 |
|---|---|---|---|---|
| **嚴格模式（預設）** | 顯示「透過 SSO 登入」按鈕，**禁止**自動 redirect | 對外 / 含敏感操作（金流、客戶資料、內部審批）| 登出視覺有效——使用者明確看到「未登入」狀態 | 每個 App 一輩子至少要點一次按鈕 |
| **企業 Portal 模式** | 沒 cookie / `/me` 401 → **自動 `window.location.href = <auth-login-url>`** 進入 SSO 鏈 | 全公司內部 admin 工具（部署平台、監控、報表）| Microsoft 365 級「打開即進」UX——跨 App 零互動 | 登出視覺傳遞會被 silent re-auth 抵消（見下節「Portal 模式登出例外」） |

**兩種模式的共同底線：**
- 都不可在 `?logged_out=1` 等明確登出旗標下自動 redirect（**Portal 模式必須保留這個例外**，否則使用者完全看不到登出效果）
- Dashboard 在工作中 401 兩個模式都走 silent re-auth
- 所有其他硬性契約（#1 / #2 / #4）兩個模式都要遵守

### Portal 模式登出例外

Portal 模式的核心副作用：使用者在別 App 登出後，打開本 App 會被 silent SSO 拉回 dashboard。要讓「主動登出」至少在當下 App 看得到效果，**Portal 模式的登入頁必須處理 `?logged_out=1` 旗標**：

| 進站來源 | 登入頁行為 |
|---|---|
| 直接打開 / refresh / 從別 App 跳過來 | 自動 redirect 進 SSO 鏈（Portal 預設） |
| **從本 App 自家登出 (`?logged_out=1`)** | **跳過自動 redirect**，顯示「已成功登出」訊息 + 登入按鈕，由使用者主動點擊才再走 SSO 鏈 |

這讓使用者「點登出」這個動作至少在當下 App 留下視覺痕跡，而非整個流程完全 silent。

### 跨 App 共享登入是 SSO 中央做的，不是各 App 做的

**不要誤會 Portal 模式 = cookie 跨域共享**。每個 App 仍然有自己 domain 上的 cookie。Portal 模式之所以能「打開即進」，是因為：

1. 使用者首次登入任一 App 時，**SSO 中央**在自己 domain（例如 `df-it-sso-login.it.zerozero.tw`）寫了一顆 session cookie
2. 使用者打開 App B 時，App B 登入頁自動 redirect 到 SSO `/authorize`
3. SSO 中央看到自己 domain 的 cookie 還活著 → silent 簽 auth code → 302 回 App B callback
4. App B callback 寫**自己 domain** 的 cookie

跨 App 體驗對齊靠的是「**SSO 中央 cookie 持久 + 各 App 自動 redirect 串完整鏈**」——這就是 Microsoft 365 / Google Workspace 的做法。Cookie 仍是 per-domain，Portal 模式不需要額外處理 cookie domain。

### 模式 B（本地帳密 + SSO）下的 Portal 模式

Portal 模式對純 Mode A（如全公司 admin 工具）很乾淨，但**Mode B 不能直接套用**——使用者可能根本不是 SSO 用戶（純本地帳號），盲目 auto-redirect 到 SSO 會把本地登入入口完全隱藏。

Mode B 的 Portal 模式必須**provider-aware**：

| 使用者狀態 | 登入頁行為 |
|---|---|
| 從未登入過 / 不知 provider | 顯示兩個選項：「透過 SSO 登入」按鈕 + 本地帳密表單。**不自動 redirect**，讓使用者主動選 |
| 上次登入是 SSO（前端有 provider hint）| 自動 redirect 到 SSO `/auth/login`（Portal 行為）|
| 上次登入是 local（前端有 provider hint）| 直接顯示本地帳密表單，**不**自動 redirect 到 SSO |

實作建議：

- 登入成功後，前端在 `localStorage` 或一顆**非 httpOnly** 的提示 cookie（例如 `last_login_provider`）寫入 `sso` 或 `local`。**這個 hint 不是憑證，洩漏無害**——它只決定登入頁怎麼顯示
- 登入頁讀此 hint 決定行為
- 登出時清掉 hint，讓使用者下次回到「兩個選項並陳」狀態（避免「我已經改用本地帳號了，但登入頁還一直 auto-redirect 到 SSO」）

這跟 Mode B 的 silent re-auth provider 分流邏輯（見後段「Silent Re-Auth Pattern」）一致：**provider 決定走哪條路**。

**純 Mode A 的 App** 不需要這層分流，登入頁可以直接 auto-redirect，無需 hint。

### Single Logout 加強模式（可選，給 Portal 模式用）

Portal 模式的副作用：使用者在別 App 主動登出後，打開本 App 會被 silent re-auth + AD silent SSO 拉回 dashboard，「登出」變成「登出 → 立刻自動登入新 session」一個無感連續動作。中央 session 真實狀態正確（舊 session 真的死了、舊 token 真的失效）但**視覺上抵消了使用者主動登出的意圖**。

要解這個視覺問題，可選擇實作 **Single Logout 加強模式**——讓 client app 短時間內記住「這個 user 剛被踢」，在 silent re-auth 之前加一道煞車。

#### 契約（雙向）

| 端 | 職責 |
|---|---|
| **Server-side**（Client App 後端）| 1. Back-channel logout 驗 HMAC + timestamp 通過後，把 `user_id` 寫進 short-TTL cache（建議 5 分鐘）<br>2. 受保護路由守衛在「中央回 401」時，從失效 token 解 payload 取出 `user_id`（**不驗簽，純讀 claims**），查 cache<br>3. 命中 → 在 401 response 加 header `X-Recently-Logged-Out: 1`<br>4. 跨 origin 部署時，CORS `expose_headers` 必須包含 `X-Recently-Logged-Out`（否則前端讀不到） |
| **Client-side**（Client App 前端）| 1. 任何 401 response 讀 `X-Recently-Logged-Out` header<br>2. header = `1` → silent re-auth 攔截器跳到 `/?logged_out=1`，不走 SSO authorize<br>3. header 不存在 → 走原本 silent re-auth 路徑（自然過期復原）|

#### 為什麼能用「不驗簽」解 token

中央已經拒絕此 token、token 已被當作失效。我們**不信任**這個 token 的 claims 做授權決定，**只用 `user_id` 當 cache key**——就算攻擊者偽造一個假 token、`user_id` 是隨便填的，最壞情況也只是查到 cache 命中的別人 user_id（如果剛好猜對）→ 給他自己看登出視覺。對攻擊者沒任何利得（cache 本來就會在他身上自然過期）。

#### TTL 取值理由

| TTL | 後果 |
|---|---|
| 太短（例：30 秒）| 使用者切到別 App 之前 cache 就過期，silent re-auth 又恢復作用 |
| 5 分鐘（建議）| 使用者主動登出後**5 分鐘內**打開任何 App 都會看到登出視覺；之後想回來只能主動點按鈕 |
| 太長（例：30 分鐘）| 阻礙使用者重新登入，必須等過久或手動清 storage |

#### 多 instance 部署注意

In-memory cache 只在單一 backend instance 內生效。如果 App 後端水平擴展，需要把 cache 換成 Redis 或類似共享 store——否則 back-channel 推到 instance A、使用者下次 request 落在 instance B、查不到 cache、加不到 header。

#### 不實作的後果

不做也不違反任何硬性契約——這只是 Portal 模式的 UX 加強。不做的話使用者會看到「登出 → 1-2 秒 silent → 又回 dashboard」的怪異 UX，但中央 session、AD session、token 失效這些**安全層面都正確**。

#### 嚴格模式不需要這個

嚴格模式登入頁本來就顯示按鈕，silent re-auth 不會自動觸發，沒有「被 silent 拉回」的問題，自然不需要這個加強模式。

---

## 必要組件清單

不論語言或框架，整合至少要實作下列組件。職責固定，命名與檔案位置可隨專案慣例。

| 組件 | 角色 |
|------|------|
| Token Store | 寫入 / 讀取 / 刪除 token cookie。Cookie 屬性： `HttpOnly` / `Secure`（prod）/ `SameSite=Lax` / `Max-Age=86400`（24h）/ `Path=/` |
| SSO HTTP 客戶端 | 包裝對中央的 server-to-server 呼叫。**強制** 等價於 `cache: no-store` 與 ≤8s timeout |
| 受保護路由守衛 | 任何需要登入的後端路由進入前，呼叫 token store + SSO 客戶端，依硬性契約 #1 即時驗證；驗證失敗回 401 並刪除本地 cookie。每個框架的對應實作見最後一節 |
| 5 個 HTTP 端點 | callback / me / logout / back-channel-logout / login 入口（規格見下節） |
| 登入頁面 | 行為見硬性契約 #3 |
| 401 攔截器（前端） | dashboard 內任何 API 401 時觸發 silent re-auth（見後段） |

---

## 必要端點規格

路徑為慣例建議，命名可調整，**契約不變**。

### 1. Callback 端點（建議 `GET /api/auth/callback`）

| 項目 | 規格 |
|------|------|
| 觸發 | 中央驗證完 SSO 後 302 帶 `?code=...` |
| 行為 | 1) 驗 `code` 存在 → 缺則 302 回登入頁帶 `?error=no_code`<br>2) POST 中央 `/api/auth/sso/exchange`，body：`{ code, client_id, client_secret }`<br>3) 成功取出 `token` → 寫入 token cookie → 302 至 dashboard 首頁 |
| 失敗處理 | 交換 4xx/5xx：302 回登入頁帶 `?error=exchange_failed`；網路例外：`?error=exchange_error` |
| 安全要求 | `client_secret` 絕不出現在前端 bundle 或 client-readable storage |

### 2. `/me` 端點（建議 `GET /api/auth/me`）

| 項目 | 規格 |
|------|------|
| 行為 | 從 token cookie 取 token → 缺則 401 `{error: "no_token"}`，否則以 `Authorization: Bearer <token>` 呼叫中央 `/api/auth/me` |
| 中央 200 | 直接回傳中央 response（不可加快取） |
| 中央 401 | 回 401 `{error: "session_expired"}` 並 **刪除本地 token cookie** |
| 中央不可達 | 回 502 `{error: "sso_unreachable"}`（**不刪 cookie**，避免短暫網路抖動踢人） |
| 硬性契約 | 每次都打中央。不可在本地驗 JWT 簽名後就直接回 user |

### 3. Logout 端點（建議 `GET /api/auth/logout`）

| 項目 | 規格 |
|------|------|
| 行為 | 取 token → 以 `Authorization: Bearer <token>` POST 中央 `/api/auth/logout`，body：`{ redirect: <fallback_url> }` |
| 中央 200 + 含 redirect | 跳轉至 response 的 `redirect` 欄位 |
| 中央 200 但無 redirect / 非 200 / 不可達 / 無 token | 跳轉 fallback URL（建議 `<app_origin>/?logged_out=1`） |
| 不論成功與否 | **同一個 response** 刪除本地 token cookie（避免「中央拒絕但本地仍登入」的不一致狀態） |
| 硬性契約 | 不能只刪本地 cookie 就回（契約 #2） |

### 4. Back-channel Logout 端點（建議 `POST /api/auth/back-channel-logout`）

| 項目 | 規格 |
|------|------|
| Body | `{ user_id: string, timestamp: number(ms), signature: string(hex) }` |
| 驗證順序 | 1) JSON 解析失敗 → 400<br>2) 任一欄位缺失 → 400<br>3) `abs(now_ms - timestamp) > 30000` → 401<br>4) 重算 `HMAC-SHA256(app_secret, "${user_id}:${timestamp}")` 並用 **constant-time 比對**（不符 → 401） |
| 行為（模式 A） | 驗證通過後**通常無事可做**（中央已刪 session，下次 `/me` 自然 401）。若 App 有快取 / WebSocket / server-push 狀態才需要主動清除 |
| 行為（模式 B） | 驗證通過後**只清 SSO 來源** session（保留本地登入使用者）— 通常以 `provider = "sso"` 過濾後刪除自家 session 紀錄 |
| 硬性契約 | 端點存在但不驗 HMAC 比 不註冊這個端點 還糟（契約 #4）。如果模式 A 真的不需要任何主動清理，**可以不註冊這條路由** |

### 5. 登入頁（建議 `GET /`）

| 項目 | 規格 |
|------|------|
| 進頁時 | 呼叫自家 `/me`：200 → 跳 dashboard；401 → 顯示「透過 DF-SSO 登入」按鈕，**不可** 自動跳轉 |
| 點按鈕 | 跳轉至 `<SSO_URL>/api/auth/sso/authorize?client_id=<id>&redirect_uri=<urlencoded(<app_url>/api/auth/callback)>` |
| 顯示錯誤 | 從 query string 讀 `error` / `logged_out` 顯示對應訊息 |
| 硬性契約 | 自動 redirect 會破壞「登出真有效」（契約 #3） |

---

## 模式 A：純 SSO

### 環境變數需求

| 變數 | 必要性 | 用途 |
|------|--------|------|
| `SSO_URL` | server-side | 中央 backend URL |
| `SSO_APP_ID` | server-side | 此 App 的 ID |
| `SSO_APP_SECRET` | server-side（**禁止前端**） | 換 token 與驗 HMAC |
| `APP_URL` | server-side | callback / redirect 用的本 App 對外 origin |
| 同名 client-side 公開變數 | client-side | 登入頁拼 authorize URL（如 Next.js 的 `NEXT_PUBLIC_*`、Vite 的 `VITE_*` 等，依框架慣例） |

`SSO_APP_ID` / `SSO_URL` / `APP_URL` 可在前端公開；`SSO_APP_SECRET` **絕不可**出現在前端 bundle / browser-readable 檔案。

> **前後端分離專案**請拆出 backend origin 與 frontend origin 兩個變數，並在 callback 裡分別處理 cookie host（backend）與 redirect host（frontend）。詳見最後一節。

### Token 驗證

只有一條路徑：**每次必打中央 `/me`**。token 是 SSO 來源的，本地不存任何 session 狀態。本地不需要 `JWT_SECRET`、不需要解 JWT，只需要把 token 原封不動轉發中央。

---

## 模式 B：本地帳密 + SSO

### 設計原則（核心安全契約）

> **一旦 session 被清除，token 必須立即失效。token 是 SSO 來源的 → 每次請求必檢查中央 session；token 是本地來源的 → 每次請求必檢查自家 session。**

### Token Payload

JWT payload 必須帶 `provider` claim：

| 欄位 | 必要性 | 說明 |
|------|--------|------|
| `userId` | 必 | 使用者識別（SSO 來源用 azure oid，本地來源用自家 PK） |
| `email` | 必 | 使用者 email |
| `provider` | 必 | `"sso"` 或 `"local"` |
| `sessionId` | local 必，sso 不需 | 對應自家 session store 的 key |

本地與 SSO **共用同一個 token cookie**，下游路由只看守衛分流結果。

### 受保護路由守衛分流

1. 取 token → 缺則 401
2. 用本地 `JWT_SECRET` 驗簽 → 失敗 401（`"invalid_token"`）
3. 看 `provider`：
   - `"sso"` → 以 Bearer 打中央 `/me`，按硬性契約 #1 處理
   - `"local"` → 查自家 session store（用 `sessionId`），不存在或過期則 401（`"session_expired"`）

### 登入路徑

| 路徑 | 行為 |
|------|------|
| `POST /api/auth/login`（本地帳密） | 驗自家帳密 → 寫自家 session → 簽 JWT（帶 `provider: "local"` + `sessionId`）→ 寫 token cookie |
| `GET /api/auth/sso/login` | 跳轉至 SSO `/authorize`（同模式 A 行為） |
| `GET /api/auth/callback` | 與模式 A 相同，但簽 JWT 時加 `provider: "sso"` |

### 登出處理

先用守衛取出當前 user：

| 當前 user | 動作 |
|---|---|
| `provider = "sso"` | 通知中央（同模式 A） |
| `provider = "local"` | 刪自家 session 紀錄 |
| 守衛已失敗 | 直接刪本地 cookie 走 fallback redirect |

### Back-channel 處理

收到 SSO 通知（HMAC 驗過後）時，**只清 SSO 來源的 session**：刪除自家 session 紀錄中 `azureOid = user_id` 且 `provider = "sso"` 的列。本地登入使用者不受影響。

---

## Silent Re-Auth Pattern（解 dashboard 401 體感 Bug）

### 問題

JWT 與中央 session 是兩個獨立計時器（[Design.md「兩種 401 情境對照」](docs/Design.md)）。使用者**在工作中**突然 401 → 直接踢回登入頁 = **體感 Bug**。

契約 #3「登入頁不自動 redirect」**僅針對登入頁**；dashboard / protected 頁面遇到 401 應走 silent re-auth。

### 攔截器職責（前端）

當任何 API 回 401：

1. **去重**：同一頁面同時觸發多個 401 時只跑一次 re-auth；其他呼叫等同一個 promise / future / latch
2. **重試上限**：以瀏覽器級 storage（如 sessionStorage）記嘗試次數，**> 2 次直接踢回登入頁** 帶 `?error=reauth_failed`，避免無限迴圈
3. **保留現場**：寫入 storage：當前 path + query（dashboard 復原用）；如有未送出表單也應序列化保存
4. **跳轉**：將整頁 navigate 至 `<SSO_URL>/api/auth/sso/authorize?...`（同登入按鈕的 URL）
5. **不要 await fetch retry**：走 navigation 後當前 page 就會卸載，retry 不會執行

### 復原職責（dashboard 進入點）

dashboard layout / shell 在掛載時：讀 storage 的「保留現場 path」，存在則清掉 attempts 與 path 兩個 key 並用 client-side router 跳回該 path。

### 模式 A vs B 的差異

| 模式 | dashboard 401 處理 |
|------|--------------------|
| **A. 純 SSO** | 一律走 silent re-auth（token 必為 SSO） |
| **B. 混合** | 先呼叫 `/me` 取 `provider`：`"sso"` → silent re-auth；`"local"` → 跳本地登入頁；不確定 → 預設 SSO 路徑 |

模式 B 實作建議：讓 `/me` 回應 user 物件帶 `provider` 欄位，前端據此分流。

### 三種 silent re-auth 結局

| 狀況 | 體感 |
|------|------|
| 中央 session 還在 | 卡頓 < 1s，回原頁面 |
| 中央 session 死，AD session 還在 | 卡頓 1-2s（AD silent SSO），回原頁面 |
| AD session 也死 | Microsoft 跳登入畫面 |

---

## 用戶資料格式

中央 `/api/auth/me` 回應：

```json
{
  "user": {
    "userId": "azure-oid",
    "email": "user@df-recycle.com",
    "name": "王小明",
    "erpData": {
      "gen01": "00063", "gen02": "王小明", "gen03": "F000",
      "gem02": "財務部", "gen06": "user@df-recycle.com"
    },
    "loginAt": "2026-04-09T10:30:00.000Z"
  }
}
```

`erpData` 可能為 `null`（AD 有但 ERP 找不到員工）。模式 B 自家包裝後請追加 `provider` 欄位。

---

## 跨框架 / 跨語言落地對應

核心永遠是 **5 個 HTTP 端點 + 1 個登入頁 + 1 個 401 攔截器**。本文件不列示範程式，請依各框架慣例對應下表落地：

| 框架 / 語言 | 受保護路由守衛慣例 | Cookie 讀寫 API | HMAC constant-time 比對 |
|------|------|------|------|
| Next.js App Router | HOF 包裝 handler（如 `withAuth(handler)`） | `cookies()` from `next/headers` | `crypto.timingSafeEqual` |
| Express / Pages Router | `(req, res, next)` middleware | `req.cookies` / `cookie-parser` | `crypto.timingSafeEqual` |
| FastAPI | `Depends(require_auth)` | `Cookie(...)` 參數 + `Response.set_cookie` | `hmac.compare_digest` |
| Spring Boot | `OncePerRequestFilter` 或 `HandlerInterceptor` | `HttpServletRequest.getCookies()` / `ResponseCookie` | `MessageDigest.isEqual` |
| Go (net/http) | middleware function 包 `http.Handler` | `r.Cookie(...)` / `http.SetCookie` | `hmac.Equal` |

### 必守規則（任何語言）

- 所有 server-to-server 呼叫：等價於 `cache: no-store` 或不加 cache header + 顯式 timeout（≤8s）
- `client_secret` 絕不出現在前端 bundle 或 client-readable storage
- back-channel 簽章驗證 **必用 constant-time 比對函式**（簡單 `==` / `equals` / `String#equals` 會洩漏時序資訊）
- back-channel timestamp tolerance **30 秒，雙向**（abs）
- 登入頁 401 顯示按鈕；dashboard 401 走 silent re-auth
- 模式 B 必有 provider 分流，**SSO 來源 token 一律即時驗中央**
- 端點若選擇不註冊（如模式 A 不需要 back-channel 主動清理）→ 整條路由拿掉，**不要留無驗證的空 handler**

### 前後端分離架構（FastAPI + Next.js / Spring Boot + React 等）

INTEGRATION.md 預設的「callback 寫 cookie / 前端讀 cookie」假設兩者同 origin。前後端分離時必須額外處理：

| 議題 | 處理方式 |
|---|---|
| Cookie 寫在哪個 origin | callback 端點放在 backend，cookie 自然寫在 backend origin |
| 前端能否讀到 cookie | 兩種解：(a) 設 cookie domain 為兩者共同 parent domain（如 `.example.com`）；(b) 前端走 BFF / proxy，由後端代轉 |
| 環境變數 | 把 `APP_URL` 拆成 `BACKEND_URL`（cookie host + callback host）與 `FRONTEND_URL`（登入頁 / dashboard / logout fallback redirect 落點） |
| CORS | 前端對 backend 的 `fetch` 必開 `credentials: include`；backend CORS allow credentials + 白名單列出前端 origin |
| `redirect_uris` 註冊 | Dashboard 註冊的是 callback 的 origin（= backend origin），不是前端的 |

---

## 常見錯誤

| 訊息 / 症狀 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯或 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯 |
| `redirect_uri is not registered` | callback 的 origin 不在白名單 |
| `exchange_failed` | auth code 過期（60s）或已使用 |
| `Too many ...` | rate limit（預設值見 Dashboard「設定」分頁） |
| `Invalid signature`（back-channel） | `SSO_APP_SECRET` 不一致或 timestamp >30s |
| 登出後其他 App 仍可用 | 正常，下次 `/me` 才 401（契約 #1） |
| 登出後立刻被自動登入 | (a) 沒 POST 中央 `/logout`（契約 #2）；(b) 登入頁在 401 時自動 redirect 到 `/authorize`（契約 #3） |
| **工作中突然被踢出** | **沒做 silent re-auth — 加 401 攔截器** |
| 模式 B：SSO 登出後該 user 仍能用本地憑證 | 正常，本地與 SSO 是兩套獨立 session |
| 模式 B：本地刪 session 後 token 還能用 | 守衛沒分流，或 SSO 來源 token 漏接 `provider === "sso"` 分支 |
| 前後端分離：前端拿不到 cookie | callback 寫 cookie 的 origin 與前端 origin 不同 → 設 cookie domain 為共同 parent，或讓前端走 BFF |
| 前後端分離：CORS 擋 cookie | 前端 fetch 沒開 `credentials: include`，或 backend CORS 沒 allow credentials |

> Rate limit 為動態值，實際以當下 SSO Dashboard「設定」分頁為準。

# 環境變數設定

設定 Microsoft Azure AD 認證所需的環境變數。

## 必要環境變數

| 變數名稱 | 說明 | 取得方式 |
|----------|------|----------|
| `AZURE_CLIENT_ID` | Application (client) ID | Azure Portal > App registrations > Overview |
| `AZURE_CLIENT_SECRET` | 用戶端密碼 | Azure Portal > App registrations > Certificates & secrets |
| `AZURE_TENANT_ID` | Directory (tenant) ID | Azure Portal > App registrations > Overview |
| `AZURE_REDIRECT_URI` | OAuth 回調 URL | 需與 Azure AD 設定一致 |
| `ROPC_REDIRECT_URL` | 登入成功後重導向路徑 | 通常為 `/` 或 `/dashboard` |

## Azure Portal 設定步驟

### 1. 建立應用程式註冊

1. 登入 [Azure Portal](https://portal.azure.com)
2. 搜尋並進入「App registrations」
3. 點擊「New registration」
4. 輸入應用程式名稱
5. 選擇支援的帳戶類型（通常選擇「單一租用戶」）
6. 點擊「Register」

### 2. 取得 Client ID 和 Tenant ID

在 App registration 的 Overview 頁面可找到：
- **Application (client) ID** → `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_TENANT_ID`

### 3. 建立 Client Secret

1. 進入「Certificates & secrets」
2. 點擊「New client secret」
3. 輸入描述並選擇有效期限
4. 點擊「Add」
5. **立即複製** Secret 的 Value → `AZURE_CLIENT_SECRET`
   > ⚠️ 離開頁面後將無法再次查看此值

### 4. 設定 Redirect URI

1. 進入「Authentication」
2. 點擊「Add a platform」
3. 選擇「Web」
4. 輸入 Redirect URI：
   ```
   https://{your-domain}/api/auth/microsoft/redirect
   ```
5. 點擊「Configure」

### 5. 設定 API 權限（選用）

1. 進入「API permissions」
2. 確認已有以下權限：
   - `openid`
   - `profile`
   - `email`
   - `User.Read`

## .env 檔案範例

```env
# Microsoft Azure AD 設定
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_REDIRECT_URI=https://your-domain.com/api/auth/microsoft/redirect
ROPC_REDIRECT_URL=/
```

## Redirect URI 格式說明

| 環境 | Redirect URI 範例 |
|------|-------------------|
| 本機開發 | `http://localhost:3000/api/auth/microsoft/redirect` |
| 正式環境 | `https://your-domain.com/api/auth/microsoft/redirect` |
| Replit | `https://{repl-slug}.{username}.repl.co/api/auth/microsoft/redirect` |
| Vercel | `https://{project}.vercel.app/api/auth/microsoft/redirect` |

> ⚠️ Azure AD 中設定的 Redirect URI 必須與環境變數 `AZURE_REDIRECT_URI` 完全一致

# 後端 API 實作

建立 Microsoft AD 登入所需的後端 API 端點。

## 必要端點

### 1. GET /api/auth/microsoft/login

重導向使用者到 Microsoft 登入頁面。

**功能：**
- 產生 state 參數防止 CSRF 攻擊
- 建構 Microsoft OAuth 授權 URL
- 重導向使用者到 Microsoft 登入頁

**實作要點：**
```javascript
router.get('/microsoft/login', async (req, res) => {
  // 1. 產生隨機 state 並存入 session
  // 2. 使用 MSAL 建構授權 URL
  // 3. 重導向到授權 URL
});
```

### 2. GET /api/auth/microsoft/redirect

處理 Microsoft OAuth callback。

**功能：**
- 驗證 state 參數
- 用 authorization code 換取 access_token 和 id_token
- 驗證 id_token 簽章
- 檢查/建立系統使用者
- 發放系統 JWT token
- 重導向到首頁

**實作要點：**
```javascript
router.get('/microsoft/redirect', async (req, res) => {
  // 1. 驗證 state 參數
  // 2. 用 code 換取 tokens
  // 3. 從 id_token 取得使用者資訊
  // 4. 查詢或建立系統使用者
  // 5. 發放系統 JWT
  // 6. 重導向到首頁
});
```

## 安裝套件

```bash
npm install @azure/msal-node
```

## 整合到現有專案

1. 閱讀專案現有的認證路由（如 `routes/auth.js`）
2. 在現有路由檔案中新增 Microsoft 登入端點
3. 確保與現有 JWT 認證機制整合
4. 參考 `examples/auth-routes.js` 取得完整範例

## 參考資料

- 完整程式碼範例：`examples/auth-routes.js`
- MSAL 設定說明：`references/msal-config.md`
- 安全性要求：`references/security-requirements.md`

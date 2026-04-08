# 前端整合

在登入頁面新增「使用 Microsoft 帳號登入」按鈕。

## 新增登入按鈕

在現有登入表單最下方新增以下 HTML：

```html
<!-- 分隔線 -->
<div class="divider">
  <span>或</span>
</div>

<!-- Microsoft 登入按鈕 -->
<a href="/api/auth/microsoft/login" class="microsoft-login-btn">
  <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
  使用 Microsoft 帳號登入
</a>
```

## 按鈕樣式

將以下 CSS 加入樣式表：

```css
.microsoft-login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 12px 20px;
  background-color: #2F2F2F;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.2s;
}

.microsoft-login-btn:hover {
  background-color: #0078D4;
}

.divider {
  display: flex;
  align-items: center;
  margin: 20px 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #ddd;
}

.divider span {
  padding: 0 10px;
  color: #888;
}
```

## 整合位置

按鈕應放置在：
1. 現有登入表單（帳號/密碼輸入）之後
2. 「忘記密碼」連結之前或之後

## 視覺預覽

```
┌─────────────────────────────┐
│  帳號: [________________]   │
│  密碼: [________________]   │
│                             │
│  [      登入      ]         │
│                             │
│  ─────── 或 ───────         │
│                             │
│  [🪟 使用 Microsoft 帳號登入] │
└─────────────────────────────┘
```

## 參考資料

- HTML 範例：`examples/login-button.html`
- CSS 範例：`examples/microsoft-button.css`

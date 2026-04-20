# UI / UX 規範

樣式、主題、共用元件的視覺與互動規則。

> 元件工程結構（目錄、命名）參閱 [10-frontend.md](10-frontend.md)

---

## 整體風格

- 全站採用**圓角設計**，所有卡片、按鈕、輸入框、Dialog 等元件統一使用 `rounded-xl`（或等效圓角值）
- 任何可被點選的元素（按鈕、連結、卡片、圖示按鈕等）**必須**加上 `hover:cursor-pointer`
- 維持一致的間距系統，使用 Tailwind spacing scale（`p-4`、`gap-6` 等），不使用任意數值

---

## 佈景主題

### 預設主題

提供**淺色**與**深色**兩種預設主題，透過 TailwindCSS `dark:` 策略搭配 CSS Variables 切換。

### 自訂主題

除預設深淺色外，提供三種自訂配色主題供使用者選擇：

| 主題名稱 | 色調方向   | 說明                                 |
| -------- | ---------- | ------------------------------------ |
| 冷色系   | 藍、青、灰 | 專業沉穩風格，適合長時間使用         |
| 暖色系   | 橙、棕、米 | 柔和溫暖風格，降低視覺疲勞           |
| 粉紫色   | 紫、粉、薰 | 活潑輕盈風格                         |

### 實作方式

- 所有色彩定義統一於 `globals.css` 的 CSS Variables，**禁止**在元件內寫死 hex 色碼
- 主題切換透過 `<html>` 的 `data-theme` 屬性控制，各主題定義獨立的 CSS Variable 區塊
- 使用者選擇的主題偏好儲存至 localStorage，重新載入時自動套用

```css
/* globals.css 範例 */
:root {
  --color-background: #ffffff;
  --color-foreground: #171717;
  --color-primary: #2563eb;
  --color-accent: #3b82f6;
}

.dark {
  --color-background: #0a0a0a;
  --color-foreground: #ededed;
  --color-primary: #60a5fa;
  --color-accent: #93c5fd;
}

[data-theme="cool"] {
  --color-background: #f0f4f8;
  --color-foreground: #1e293b;
  --color-primary: #0ea5e9;
  --color-accent: #06b6d4;
}

[data-theme="warm"] {
  --color-background: #fdf6ec;
  --color-foreground: #44403c;
  --color-primary: #ea580c;
  --color-accent: #f59e0b;
}

[data-theme="purple"] {
  --color-background: #faf5ff;
  --color-foreground: #3b0764;
  --color-primary: #a855f7;
  --color-accent: #e879f9;
}
```

---

## Header

Header 為全站共用，固定於頂部，結構如下：

```text
┌──────────────────────────────────────────────────────────────────┐
│  [☰] [SVG 圖示] Agents-Platform          [🎨] {Username} [登出] │
└──────────────────────────────────────────────────────────────────┘
```

- **左側**：Sidebar 選單切換按鈕（☰）+ SVG 圖示 + 「Agents-Platform」文字，Logo 區塊點擊可回到主頁
- **右側**：主題切換按鈕（🎨）+ 當前登入的 `{Username}` + 登出按鈕
- 主題切換按鈕點擊後展開下拉選單，列出所有可用主題（淺色 / 深色 / 冷色系 / 暖色系 / 粉紫色）
- Sidebar 切換按鈕控制左側選單，共三種狀態：完整展開（圖示+文字）→ 收合（僅圖示）→ 完全隱藏，再點擊循環回完整展開
- `md` 以下 Sidebar 預設隱藏，點擊按鈕以 overlay 方式展開，可關閉
- Header 高度固定，背景色跟隨主題 CSS Variable
- 響應式：`sm` 以下「Agents-Platform」文字隱藏，僅保留 SVG 圖示

---

## 頁面佈局

所有登入後頁面（`(main)` 群組）共用相同的 main section 佈局結構：

```text
Sidebar 展開：                          Sidebar 隱藏：
┌──────────────────────────────────┐    ┌──────────────────────────────┐
│             Header               │    │            Header            │
├────────┬─────────────────────────┤    ├──────────────────────────────┤
│        │       Page Title        │    │         Page Title           │
│Sidebar │ ┌─────────────────────┐ │    │ ┌──────────────────────────┐ │
│        │ │                     │ │    │ │                          │ │
│        │ │   Main Content      │ │    │ │      Main Content        │ │
│        │ │                     │ │    │ │                          │ │
│        │ └─────────────────────┘ │    │ └──────────────────────────┘ │
└────────┴─────────────────────────┘    └──────────────────────────────┘
```

- 每個頁面的 main section 皆包含：**Page Title 區塊** + **Main Content 卡片容器**
- Main Content 區域使用統一的圓角卡片容器（`rounded-xl` + 背景色 + 陰影）
- 各頁面**禁止**自行定義外層佈局結構，僅填充 Main Content 內部內容
- 佈局由 `(main)/layout.tsx` 統一控制

---

## Dialog 元件

- **禁止**使用瀏覽器原生 `alert()` / `confirm()` / `prompt()`，所有提示訊息一律透過 Dialog 元件呈現
- 提供共用方法（如 `useDialog` Hook 或全域 `dialogStore`），讓任何元件皆可透過程式觸發 Dialog，無須各自引入元件
- Dialog 容器同樣採用圓角設計（`rounded-xl`）

Dialog 須區分三種類型，各有對應的視覺樣式與預設行為：

| 類型    | 用途           | 圖示/色調 | 預設按鈕    |
| ------- | -------------- | --------- | ----------- |
| Info    | 一般資訊告知   | 藍色      | 確認        |
| Warning | 需使用者注意   | 黃色      | 取消 / 確認 |
| Error   | 錯誤或失敗通知 | 紅色      | 確認        |

使用範例：

```typescript
const { showDialog } = useDialog();
showDialog({ type: "error", title: "操作失敗", message: "無法取得資料" });
```

---

## 表單驗證回饋

- 欄位驗證錯誤即時顯示於該欄位下方，使用紅色文字提示
- 表單送出後的伺服器錯誤透過 Dialog（Error 類型）呈現
- 送出按鈕在請求期間須顯示 loading 狀態並禁用，防止重複提交

---

## 響應式設計（RWD）

- 以 **Mobile First** 為基礎，依序向上擴展
- 使用 Tailwind 預設斷點：

| 斷點 | 寬度      | 佈局變化                      |
| ---- | --------- | ----------------------------- |
| 預設 | < 640px   | 單欄、Sidebar 隱藏為漢堡選單  |
| `sm` | >= 640px  | 單欄、元素間距微調            |
| `md` | >= 768px  | Sidebar 展開、雙欄佈局        |
| `lg` | >= 1024px | Main Content 區域加寬         |
| `xl` | >= 1280px | 最大內容寬度，置中顯示        |

- Sidebar 於 `md` 以下自動收合為漢堡選單，點擊展開為 overlay
- 表格於小螢幕可水平捲動或改為卡片式呈現
- 所有互動元素的觸控區域至少 44x44px（符合無障礙標準）

---

## Loading 狀態

- 頁面級載入使用全頁 Skeleton 或 Spinner
- 元件級載入使用局部 Skeleton，避免整頁閃爍
- 按鈕操作中顯示 Spinner 並禁用，防止重複觸發
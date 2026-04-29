# 初始化 SSO 登入器整合（Python FastAPI）

在當前 FastAPI 專案中自動建立 DF-SSO 登入器所需的所有 backend 檔案（APIRouter、設定、HTTP client、HMAC 驗章）。
**執行前會詢問必要資訊，之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的契約。**此 command 建立的是模式 A（純 SSO）的 backend**；登入頁與 401 攔截器在前端 SPA（React/Vue/...），完成訊息有對應片段。
> 預設 **FastAPI 0.110+ / Python 3.10+**，使用 `httpx.AsyncClient` + `pydantic-settings`。

## 硬性契約（必看，漏一條就壞）

1. **`/me` 即時回源中央**：`require_auth` 內每次都打中央 `/api/auth/me`，**禁止本地快取 user**
2. **登出 POST 中央 + 跟隨 redirect**：`/api/auth/logout` 必須先通知中央再清本地 cookie
3. **登入頁 401 顯示按鈕，不自動 redirect**：前端 SPA 的登入頁在 `/me` 401 時**只**顯示按鈕；自動 redirect 會破壞「登出真有效」
4. **Back-channel logout 必驗 HMAC + timestamp**：`hmac.compare_digest` + 30s drift；不註冊端點 比 註冊但不驗 還安全

完整契約見 [INTEGRATION.md](../../INTEGRATION.md)「硬性契約」與「Silent Re-Auth Pattern」。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器的網址
   - Prod：`https://df-it-sso-login.it.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **Backend URL** — 你的後端對外網址（callback 落點 + cookie host，例如 `https://api.warehouse.apps.zerozero.tw`，本機 `http://localhost:8000`）
3. **Frontend URL** — 你的前端對外網址（登入頁 / dashboard / logout fallback redirect 落點，例如 `https://warehouse.apps.zerozero.tw`，本機 `http://localhost:3000`）
   - 若前後端**同 origin**（例如 server-render 或 monolith），填同一個 URL 即可
4. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
5. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元，保密）
6. **App 目錄** — FastAPI 專案的 app 套件目錄（例如 `app`、`src`、`backend`），預設 `app`
7. **App Port** — 你的後端 Port（例如 `8000`）

## 前置檢查

執行前先確認 `pyproject.toml` / `requirements.txt` 已含：

- [ ] `fastapi>=0.110`
- [ ] `httpx>=0.27`
- [ ] `pydantic>=2.0`
- [ ] `pydantic-settings>=2.0`
- [ ] `python-dotenv`（若要自動讀 `.env`）

若缺，請先補上：

```bash
pip install "fastapi>=0.110" "httpx>=0.27" "pydantic-settings>=2.0" python-dotenv
```

## 執行步驟

假設使用者填入的 app 目錄為 `{APP_DIR}`（預設 `app`）。下列所有路徑都以此為基準。

### 1. 建立 `{APP_DIR}/sso/__init__.py`

```python
from .router import router as sso_router
from .config import sso_settings
from .deps import require_auth, SsoUser

__all__ = ["sso_router", "sso_settings", "require_auth", "SsoUser"]
```

### 2. 建立 `{APP_DIR}/sso/config.py`

`backend_url` 是 callback 落點 + cookie host，`frontend_url` 是登入頁 / dashboard / logout fallback。前後端同 origin 時兩者相等。

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class SsoSettings(BaseSettings):
    """DF-SSO 登入器設定，全部從環境變數讀取。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    sso_url: str = "http://localhost:3001"
    sso_app_id: str = ""
    sso_app_secret: str = ""
    backend_url: str = "http://localhost:{使用者填的 Port}"
    frontend_url: str = "http://localhost:{使用者填的 Port}"
    sso_timeout_seconds: float = 8.0

    @property
    def is_secure(self) -> bool:
        """Backend 是否走 HTTPS（決定 cookie secure 旗標）。"""
        return self.backend_url.startswith("https://")


sso_settings = SsoSettings()
```

### 3. 建立 `{APP_DIR}/sso/client.py`

```python
from typing import Any

import httpx

from .config import sso_settings


async def _request(method: str, path: str, **kwargs: Any) -> httpx.Response:
    """所有 server-to-server 呼叫的共通 entry point。

    - 固定 timeout
    - 禁用 cache
    - 呼叫端負責判斷 status code
    """
    timeout = httpx.Timeout(sso_settings.sso_timeout_seconds)
    headers = kwargs.pop("headers", {}) or {}
    headers.setdefault("Cache-Control", "no-store")

    async with httpx.AsyncClient(base_url=sso_settings.sso_url, timeout=timeout) as client:
        return await client.request(method, path, headers=headers, **kwargs)


async def exchange(code: str) -> dict[str, Any] | None:
    """用 auth code 換 SSO token（帶 client_secret，server-to-server）。"""
    res = await _request(
        "POST",
        "/api/auth/sso/exchange",
        json={
            "code": code,
            "client_id": sso_settings.sso_app_id,
            "client_secret": sso_settings.sso_app_secret,
        },
    )
    if res.status_code != 200:
        return None
    return res.json()


async def me(token: str) -> tuple[int, dict[str, Any] | None]:
    """以 Bearer token 呼叫 SSO /me，回傳 (status_code, payload)。契約 #1：每次都回源。"""
    res = await _request(
        "GET",
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    if res.status_code != 200:
        return res.status_code, None
    return 200, res.json()


async def logout(token: str, redirect_after: str) -> str | None:
    """通知 SSO 登出（兩層 Session 模型，契約 #2）：中央刪 Redis session + back-channel 通知所有 App。
    AD session 完全不動。SSO 回傳已驗證 origin 的 redirect URL，Caller 把瀏覽器 302 過去即可。

    redirect_after: 登出後最終要落地的 URL（origin 必須在 sso_allowed_list）
    回傳: SSO 驗證後的 redirect；SSO 不可達或 200 但缺欄位則回 None
    """
    try:
        res = await _request(
            "POST",
            "/api/auth/logout",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"redirect": redirect_after},
        )
        if res.status_code != 200:
            return None
        body = res.json()
        url = body.get("redirect") if isinstance(body, dict) else None
        return url if isinstance(url, str) else None
    except Exception:
        return None
```

### 4. 建立 `{APP_DIR}/sso/security.py`

```python
import hashlib
import hmac
import time


MAX_TIMESTAMP_DRIFT_MS = 30_000  # 30 秒（雙向 abs）


def verify_back_channel_signature(
    user_id: str,
    timestamp: int,
    signature: str,
    app_secret: str,
) -> tuple[bool, str | None]:
    """驗 back-channel logout 的 HMAC 簽章（契約 #4）。

    回傳 (is_valid, error_reason):
    - error_reason: "timestamp_expired" | "invalid_signature" | None
    - 使用 hmac.compare_digest 做 constant-time compare，
      對齊 SSO backend 的 crypto.timingSafeEqual。
    """
    now_ms = int(time.time() * 1000)
    if abs(now_ms - timestamp) > MAX_TIMESTAMP_DRIFT_MS:
        return False, "timestamp_expired"

    expected = hmac.new(
        app_secret.encode("utf-8"),
        f"{user_id}:{timestamp}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if len(signature) != len(expected) or not hmac.compare_digest(signature, expected):
        return False, "invalid_signature"

    return True, None
```

### 5. 建立 `{APP_DIR}/sso/deps.py` — Auth Middleware（FastAPI Depends）

**整個整合的核心**。所有 protected endpoint（包含 `/me` 本身）都必須透過這個 `require_auth` dependency，才能保證契約 #1（中央 session 被撤銷後下一次呼叫立即失效）。

```python
from typing import Any

from fastapi import Cookie, HTTPException, Response, status
from pydantic import BaseModel

from . import client


TOKEN_COOKIE = "token"


class SsoUser(BaseModel):
    userId: str
    email: str
    name: str
    erpData: dict[str, str] | None = None
    loginAt: str


def _clear_token_cookie(resp: Response) -> None:
    resp.delete_cookie(key=TOKEN_COOKIE, path="/")


async def require_auth(
    response: Response,
    token: str | None = Cookie(default=None),
) -> SsoUser:
    """Protected endpoint 入口都 Depends 這個。成功 → SsoUser；失敗 → HTTPException。

    no_token        → 401 + no_token（前端應跳登入頁顯示按鈕）
    session_expired → 401 + session_expired + 清本地 cookie（前端走 silent re-auth）
    sso_unreachable → 502（SSO 暫時不可達；不刪 cookie，避免抖動踢人）
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "no_token"},
        )

    try:
        code, payload = await client.me(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "sso_unreachable"},
        )

    if code == 401:
        _clear_token_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "session_expired"},
        )
    if code != 200 or payload is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "sso_unreachable"},
        )

    user_data: dict[str, Any] = payload.get("user") or {}
    return SsoUser(**user_data)
```

### 6. 建立 `{APP_DIR}/sso/router.py`

```python
import logging

from fastapi import APIRouter, Cookie, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from . import client
from .config import sso_settings
from .deps import SsoUser, require_auth, TOKEN_COOKIE
from .security import verify_back_channel_signature


log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["sso"])

COOKIE_MAX_AGE = 24 * 60 * 60  # 24 小時


def _set_token_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        key=TOKEN_COOKIE,
        value=token,
        httponly=True,
        secure=sso_settings.is_secure,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


def _clear_token_cookie(resp: Response) -> None:
    resp.delete_cookie(key=TOKEN_COOKIE, path="/")


# ---------- 1. OAuth callback ----------
@router.get("/callback")
async def callback(code: str | None = None) -> Response:
    """SSO 授權完成後的 callback：用 code 換 token，寫 cookie，導回 frontend dashboard。"""
    if not code:
        return RedirectResponse(url=f"{sso_settings.frontend_url}/?error=no_code", status_code=302)

    try:
        data = await client.exchange(code)
    except Exception as e:
        log.warning("[SSO] exchange failed: %s", e)
        return RedirectResponse(url=f"{sso_settings.frontend_url}/?error=exchange_error", status_code=302)

    if not data or not data.get("token"):
        return RedirectResponse(url=f"{sso_settings.frontend_url}/?error=exchange_failed", status_code=302)

    resp = RedirectResponse(url=f"{sso_settings.frontend_url}/dashboard", status_code=302)
    _set_token_cookie(resp, data["token"])
    return resp


# ---------- 2. /me（Depends require_auth，一行 handler） ----------
@router.get("/me")
async def me(user: SsoUser = Depends(require_auth)) -> dict:
    """`/me` 本身就是 middleware 的第一個使用者，handler 只負責回 user。"""
    return {"user": user.model_dump()}


# ---------- 3. /logout（契約 #2） ----------
@router.get("/logout")
async def logout(token: str | None = Cookie(default=None)) -> Response:
    """通知 SSO 登出 + 清本地 cookie + 跳 SSO 回傳的 redirect。AD session 不動。
    取不到 redirect 時 fallback 回 frontend 首頁帶 ?logged_out=1。
    """
    fallback = f"{sso_settings.frontend_url}/?logged_out=1"
    target = fallback
    if token:
        url = await client.logout(token, fallback)
        if url:
            target = url
    # 不論成功與否：同一 response 刪 cookie
    resp = RedirectResponse(url=target, status_code=302)
    _clear_token_cookie(resp)
    return resp


# ---------- 4. Back-channel logout（契約 #4） ----------
class BackChannelPayload(BaseModel):
    user_id: str
    timestamp: int
    signature: str


@router.post("/back-channel-logout")
async def back_channel_logout(payload: BackChannelPayload, request: Request) -> Response:
    """SSO 廣播登出：驗 HMAC + timestamp drift 後清該 user 的本地 session。
    模式 A 純 SSO 通常不需動作；若無任何 server-side state 可整支不註冊。
    """
    ok, reason = verify_back_channel_signature(
        user_id=payload.user_id,
        timestamp=payload.timestamp,
        signature=payload.signature,
        app_secret=sso_settings.sso_app_secret,
    )
    if not ok:
        status_code = 401 if reason in ("timestamp_expired", "invalid_signature") else 400
        return JSONResponse(status_code=status_code, content={"error": reason})

    log.info("[SSO] Back-channel logout user_id=%s", payload.user_id)
    # TODO: 若有 in-process 快取 / WebSocket / Redis session，在這裡 invalidate user_id
    return JSONResponse(status_code=200, content={"success": True})
```

### 7. 在 `main.py` 掛上 router 與 CORS（前後端分離必設）

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from {APP_DIR}.sso import sso_router, sso_settings

app = FastAPI()

# 前後端分離時必須允許前端 origin + credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=[sso_settings.frontend_url],
    allow_credentials=True,  # 允許帶 cookie
    allow_methods=["*"],
    allow_headers=["*"],
)

# ... 原本的其他 routes ...
app.include_router(sso_router)
```

> 若 `frontend_url == backend_url`（同 origin），CORS middleware 仍可保留，不會有副作用。
> 若是 `src/main.py` 結構，import 路徑要調成 `from src.sso import sso_router, sso_settings`。

### 8. 建立或更新 `.env`

在專案根目錄 `.env` **追加**下列環境變數（不覆蓋原有內容）：

```
# DF-SSO 登入器
SSO_URL={使用者填的 SSO URL}
SSO_APP_ID={使用者填的 App ID}
SSO_APP_SECRET={使用者填的 App Secret}
BACKEND_URL={使用者填的 Backend URL}
FRONTEND_URL={使用者填的 Frontend URL}
```

> ⚠️ `SSO_APP_SECRET` **絕不可** commit 進 git，也不可透過任何前端 bundler 暴露出去。
> ⚠️ `.env` 的變數名必須是大寫，pydantic-settings 會自動映射到 `SsoSettings` 的小寫欄位。
> ⚠️ SSO Dashboard 的 `redirect_uris` 註冊的是 callback 的 origin = **BACKEND_URL**，不是 frontend。

同步更新 `.gitignore`（若尚未含）：

```
.env
.env.local
.env.*.local
```

### 9. 顯示完成訊息

```
✅ SSO 登入器整合完成（FastAPI / 模式 A 純 SSO）！

已建立的檔案：
  {APP_DIR}/sso/__init__.py
  {APP_DIR}/sso/config.py        — backend_url + frontend_url 兩個 origin
  {APP_DIR}/sso/client.py        — server-to-server 呼叫 SSO 中央
  {APP_DIR}/sso/security.py      — HMAC + timestamp 驗章（契約 #4）
  {APP_DIR}/sso/deps.py          — require_auth Depends（契約 #1）
  {APP_DIR}/sso/router.py        — 4 個 backend 端點
  main.py                        — 已掛上 sso_router + CORS allow_credentials
  .env                           — 已追加 SSO 環境變數

📋 接下來你需要：

1. 確認 SSO Dashboard 的白名單：
   - 網域：{使用者填的 Backend URL}（callback 落點）
   - Redirect URIs 要包含：{使用者填的 Backend URL}
   - 若 BACKEND_URL ≠ FRONTEND_URL，FRONTEND_URL 也要加進 redirect_uris（logout fallback 落點驗證）

2. 所有需要登入的 protected endpoint 一律 Depends(require_auth)：

   from fastapi import APIRouter, Depends
   from {APP_DIR}.sso import require_auth, SsoUser

   router = APIRouter()

   @router.get("/api/assets")
   async def list_assets(user: SsoUser = Depends(require_auth)):
       # 每次呼叫都已向中央 Redis 確認 session
       return {"viewer": user.email, "assets": []}

3. 啟動 FastAPI 驗證端點：
   uvicorn {APP_DIR}.main:app --reload --port {使用者填的 Port}
   curl http://localhost:{使用者填的 Port}/api/auth/me  # 應該回 401 no_token

4. 前端 SPA（React/Vue）需實作：

   (A) 登入頁（契約 #3：401 顯示按鈕，禁止自動 redirect）

   const SSO_URL = "{使用者填的 SSO URL}";
   const BACKEND_URL = "{使用者填的 Backend URL}";
   const APP_ID  = "{使用者填的 App ID}";

   const ssoUrl = `${SSO_URL}/api/auth/sso/authorize`
     + `?client_id=${encodeURIComponent(APP_ID)}`
     + `&redirect_uri=${encodeURIComponent(BACKEND_URL + "/api/auth/callback")}`;

   useEffect(() => {
     fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" })
       .then(res => res.ok ? location.href = "/dashboard" : setShowButton(true));
   }, []);

   {showButton && <button onClick={() => location.href = ssoUrl}>透過 DF-SSO 登入</button>}

   (B) Dashboard 401 攔截器（silent re-auth；契約 #3 不適用 dashboard）

   const STORAGE_PATH = "sso_reauth_path";
   const STORAGE_ATTEMPTS = "sso_reauth_attempts";
   let inFlight = null;

   async function authedFetch(url, init) {
     const res = await fetch(url, { credentials: "include", ...init });
     if (res.status === 401) {
       if (inFlight) return inFlight;
       inFlight = new Promise(() => {
         const n = Number(sessionStorage.getItem(STORAGE_ATTEMPTS) || "0");
         if (n >= 2) {
           sessionStorage.removeItem(STORAGE_PATH);
           sessionStorage.removeItem(STORAGE_ATTEMPTS);
           location.href = `${FRONTEND_URL}/?error=reauth_failed`;
           return;
         }
         sessionStorage.setItem(STORAGE_ATTEMPTS, String(n + 1));
         sessionStorage.setItem(STORAGE_PATH, location.pathname + location.search);
         location.href = ssoUrl; // 整頁卸載
       });
       return inFlight;
     }
     return res;
   }

   // dashboard 入口復原
   useEffect(() => {
     const saved = sessionStorage.getItem(STORAGE_PATH);
     if (saved) {
       sessionStorage.removeItem(STORAGE_PATH);
       sessionStorage.removeItem(STORAGE_ATTEMPTS);
       router.replace(saved);
     }
   }, []);

   (C) 登出按鈕：

   <a href={`${BACKEND_URL}/api/auth/logout`}>登出</a>

5. 前後端分離的 cookie 注意：
   - cookie 寫在 BACKEND_URL origin
   - 前端對 backend 的 fetch 必須帶 credentials: "include"
   - 若 frontend 與 backend 不同 origin 且要在前端讀 cookie：
     設 cookie domain 為共同 parent（如 .apps.zerozero.tw），或讓前端走 BFF/proxy
```

## 注意事項

- **Async vs sync**：`httpx.AsyncClient` 對齊 FastAPI 的 async-first 設計。若你的專案是純同步（用 `def` 而不是 `async def`），把 `httpx.AsyncClient` 換成 `httpx.Client`、把 router 的 `async def` 改成 `def`，其他邏輯完全一樣
- **Cookie secure 旗標**：依 `backend_url` 協定自動決定；Prod `https://` 自動打開，本機 `http://` 不打（否則瀏覽器不送 cookie）
- **SameSite**：固定 `Lax`，對齊 [INTEGRATION.md](../../INTEGRATION.md)。跨 domain iframe 嵌入才需 `None`+`Secure`
- **登入頁 vs dashboard 401 處理不一樣**：登入頁（契約 #3）禁止自動 redirect；dashboard 工作中（silent re-auth）必須自動 redirect。前端 SPA 兩個邏輯要分清楚
- **CORS allow_credentials**：前後端不同 origin 時是必要條件；缺一行就會「fetch 200 但前端拿不到 cookie」
- **back-channel logout 的 TODO**：模式 A 純 SSO 通常不需動作；若你用 Redis / DB 存 server-side session，在 `back_channel_logout` 裡要實際清掉該 `user_id` 的 session。**保留無驗證的端點 比 不註冊還糟**——前者騙系統有保護
- **HMAC constant-time compare**：`hmac.compare_digest` 是 Python 標準函式庫內建的 constant-time 比對，對齊 SSO backend 的 `crypto.timingSafeEqual`
- **pydantic-settings 版本**：範例用 Pydantic v2 的 `pydantic-settings`。若卡在 Pydantic v1，請改成 `from pydantic import BaseSettings` 並移除 `SettingsConfigDict`
- **HTTPX connection reuse**：為簡化，每次呼叫都新開 `AsyncClient`。若 SSO 呼叫量很大想共用連線池，可在 FastAPI `lifespan` 裡建立單一 `AsyncClient` 並注入
- **模式 B（本地帳密 + SSO）**：JWT payload 加 `provider` claim、`require_auth` 依 `provider` 分流（SSO → 本流程；local → 查自家 session store）。本 command 不自動建立模式 B；細節見 [INTEGRATION.md](../../INTEGRATION.md)「模式 B」
- 若 `{APP_DIR}/sso/` 目錄已存在同名檔案，詢問使用者是否覆蓋

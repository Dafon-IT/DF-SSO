# 初始化 SSO 登入器整合（Python FastAPI）

在當前 FastAPI 專案中自動建立 DF-SSO 登入器所需的所有檔案（APIRouter、設定、HTTP client、HMAC 驗章）。
**執行前會詢問必要資訊,之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的 4 個端點設計：`/callback`、`/me`、`/logout`、`/back-channel-logout`。
> 預設 **FastAPI 0.110+ / Python 3.10+**,使用 `httpx.AsyncClient` + `pydantic-settings`。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器的網址
   - Prod：`https://df-sso-login.apps.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **App URL** — 你的專案網址（例如 `https://warehouse.apps.zerozero.tw`,本機 `http://localhost:8000`）
3. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
4. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元,保密）
5. **App 目錄** — FastAPI 專案的 app 套件目錄（例如 `app`、`src`、`backend`）,預設 `app`
6. **App Port** — 你的專案 Port（例如 `8000`）

## 前置檢查

執行前先確認 `pyproject.toml` / `requirements.txt` 已含：

- [ ] `fastapi>=0.110`
- [ ] `httpx>=0.27`
- [ ] `pydantic>=2.0`
- [ ] `pydantic-settings>=2.0`
- [ ] `python-dotenv`（若要自動讀 `.env`）

若缺,請先補上：

```bash
pip install "fastapi>=0.110" "httpx>=0.27" "pydantic-settings>=2.0" python-dotenv
```

或在 `requirements.txt` 加上對應行。

## 執行步驟

假設使用者填入的 app 目錄為 `{APP_DIR}`(預設 `app`)。下列所有路徑都以此為基準。

### 1. 建立 `{APP_DIR}/sso/__init__.py`

```python
from .router import router as sso_router
from .config import sso_settings
from .deps import require_auth, SsoUser

__all__ = ["sso_router", "sso_settings", "require_auth", "SsoUser"]
```

### 2. 建立 `{APP_DIR}/sso/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class SsoSettings(BaseSettings):
    """DF-SSO 登入器設定,全部從環境變數讀取。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    sso_url: str = "http://localhost:3001"
    sso_app_id: str = ""
    sso_app_secret: str = ""
    app_url: str = "http://localhost:{使用者填的 Port}"
    sso_timeout_seconds: float = 8.0

    @property
    def is_secure(self) -> bool:
        """App 是否走 HTTPS（決定 cookie secure 旗標）。"""
        return self.app_url.startswith("https://")


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
    """用 auth code 換 SSO token(帶 client_secret,server-to-server)。"""
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
    """以 Bearer token 呼叫 SSO /me,回傳 (status_code, payload)。"""
    res = await _request(
        "GET",
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    if res.status_code != 200:
        return res.status_code, None
    return 200, res.json()


async def logout(token: str, redirect_after: str) -> str | None:
    """通知 SSO 登出,並回傳 SSO 給的 Microsoft AD logout_url(含 id_token_hint
    + SSO post-logout 跳板)。Caller 必須把瀏覽器導去這個 URL,否則 AD 端
    SSO cookie 沒清掉,使用者 Refresh 會被靜默重新登入。

    redirect_after: AD 登出後最終要落地的 URL(必須在 sso_allowed_list)
    回傳: logout_url;SSO 不可達或 200 但缺欄位則回 None
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
        url = body.get("logout_url") if isinstance(body, dict) else None
        return url if isinstance(url, str) else None
    except Exception:
        return None
```

### 4. 建立 `{APP_DIR}/sso/security.py`

```python
import hashlib
import hmac
import time


MAX_TIMESTAMP_DRIFT_MS = 30_000  # 30 秒


def verify_back_channel_signature(
    user_id: str,
    timestamp: int,
    signature: str,
    app_secret: str,
) -> tuple[bool, str | None]:
    """驗 back-channel logout 的 HMAC 簽章。

    回傳 (is_valid, error_reason):
    - error_reason: "timestamp_expired" | "invalid_signature" | None
    - 使用 hmac.compare_digest 做 constant-time compare,
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

**整個整合的核心**。所有 protected endpoint（包含 `/me` 本身）都必須透過這個 `require_auth` dependency，才能保證「中央 session 被撤銷後下一次呼叫立即失效」。

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

    no_token      → 401 + no_token（前端應自動導向 SSO）
    session_expired → 401 + session_expired + 清本地 cookie（前端顯示按鈕）
    sso_unreachable → 502（SSO 暫時不可達）
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
            detail={"error": "sso_error"},
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
    """SSO 授權完成後的 callback:用 code 換 token,寫 cookie,導回 /dashboard。"""
    if not code:
        return RedirectResponse(url=f"{sso_settings.app_url}/?error=no_code", status_code=302)

    try:
        data = await client.exchange(code)
    except Exception as e:
        log.warning("[SSO] exchange failed: %s", e)
        return RedirectResponse(url=f"{sso_settings.app_url}/?error=exchange_error", status_code=302)

    if not data or not data.get("token"):
        return RedirectResponse(url=f"{sso_settings.app_url}/?error=exchange_failed", status_code=302)

    resp = RedirectResponse(url=f"{sso_settings.app_url}/dashboard", status_code=302)
    _set_token_cookie(resp, data["token"])
    return resp


# ---------- 2. /me（直接 Depends require_auth，一行 handler） ----------
@router.get("/me")
async def me(user: SsoUser = Depends(require_auth)) -> dict:
    """`/me` 本身就是 middleware 的第一個使用者,handler 只負責回 user。"""
    return {"user": user.model_dump()}


# ---------- 3. /logout ----------
@router.get("/logout")
async def logout(token: str | None = Cookie(default=None)) -> Response:
    """通知 SSO 登出,清自家 cookie,把瀏覽器導向 SSO 給的 AD logout_url。
    AD 清完自己的 SSO cookie 後會經 SSO post-logout 跳板回到 /?logged_out=1。
    取不到 logout_url 時 fallback 直接回首頁(此時 AD session 仍活著,
    使用者重新整理可能會被靜默重登)。
    """
    fallback = f"{sso_settings.app_url}/?logged_out=1"
    target = fallback
    if token:
        url = await client.logout(token, fallback)
        if url:
            target = url
    resp = RedirectResponse(url=target, status_code=302)
    _clear_token_cookie(resp)
    return resp


# ---------- 4. Back-channel logout ----------
class BackChannelPayload(BaseModel):
    user_id: str
    timestamp: int
    signature: str


@router.post("/back-channel-logout")
async def back_channel_logout(payload: BackChannelPayload, request: Request) -> Response:
    """SSO 廣播登出:驗 HMAC + timestamp drift 後清該 user 的本地 session。"""
    ok, reason = verify_back_channel_signature(
        user_id=payload.user_id,
        timestamp=payload.timestamp,
        signature=payload.signature,
        app_secret=sso_settings.sso_app_secret,
    )
    if not ok:
        status = 401 if reason in ("timestamp_expired", "invalid_signature") else 400
        return JSONResponse(status_code=status, content={"error": reason})

    log.info("[SSO] Back-channel logout user_id=%s", payload.user_id)
    # TODO: 清掉該 user 在本 App 的 server-side session(若有,例如 Redis / DB session store)
    return JSONResponse(status_code=200, content={"success": True})
```

### 7. 在 `main.py` 掛上 router

找到 FastAPI 專案的入口(通常是 `{APP_DIR}/main.py` 或 `main.py`),加上：

```python
from fastapi import FastAPI
from {APP_DIR}.sso import sso_router

app = FastAPI()

# ... 原本的其他 routes ...
app.include_router(sso_router)
```

> 若是 `src/main.py` 結構,import 路徑要調成 `from src.sso import sso_router`。
> 若尚未建立 `main.py`,請同步建立一個最小骨架(不覆蓋既有檔案)。

### 8. 建立或更新 `.env`

在專案根目錄 `.env` **追加**下列環境變數(不覆蓋原有內容)：

```
# DF-SSO 登入器
SSO_URL={使用者填的 SSO URL}
SSO_APP_ID={使用者填的 App ID}
SSO_APP_SECRET={使用者填的 App Secret}
APP_URL={使用者填的 App URL}
```

> ⚠️ `SSO_APP_SECRET` **絕不可** commit 進 git,也不可透過任何前端 bundler 暴露出去。
> ⚠️ `.env` 的變數名必須是大寫,pydantic-settings 會自動映射到 `SsoSettings` 的小寫欄位。

同步更新 `.gitignore`(若尚未含):

```
.env
.env.local
.env.*.local
```

### 9. 顯示完成訊息

告知使用者：

```
✅ SSO 登入器整合完成（Python FastAPI）!

已建立的檔案：
  {APP_DIR}/sso/__init__.py
  {APP_DIR}/sso/config.py
  {APP_DIR}/sso/client.py
  {APP_DIR}/sso/security.py
  {APP_DIR}/sso/deps.py    — require_auth FastAPI Depends（auth middleware）
  {APP_DIR}/sso/router.py  — 4 個端點，/me 一行 Depends(require_auth)
  main.py — 已掛上 sso_router
  .env — 已追加 SSO 環境變數

📋 接下來你需要：

1. 確認 SSO Dashboard 的白名單：
   - 網域:{使用者填的 App URL}
   - Redirect URIs 要包含:{使用者填的 App URL}
   取得 app_id / app_secret 後填進 .env

2. 所有需要登入的 protected endpoint 一律 Depends(require_auth)：

   from fastapi import APIRouter, Depends
   from {APP_DIR}.sso import require_auth, SsoUser

   router = APIRouter()

   @router.get("/api/assets")
   async def list_assets(user: SsoUser = Depends(require_auth)):
       # user 保證已登入；每次呼叫都已向中央 Redis 確認 session
       return {"viewer": user.email, "assets": []}

3. 需要 role/權限檢查時，在 endpoint 內拿 user 繼續判斷：

   @router.get("/api/reports")
   async def reports(user: SsoUser = Depends(require_auth)):
       if not user.email.endswith("@df-recycle.com"):
           raise HTTPException(status_code=403, detail="forbidden")
       return {...}

4. 啟動 FastAPI 驗證端點：
   uvicorn {APP_DIR}.main:app --reload --port {使用者填的 Port}
   curl http://localhost:{使用者填的 Port}/api/auth/me  # 應該回 401 no_token

5. 在你的登入頁（React / Vue / Jinja 都可）加上按鈕：

   const SSO_URL = "{使用者填的 SSO URL}";
   const APP_URL = "{使用者填的 App URL}";
   const APP_ID  = "{使用者填的 App ID}";

   const ssoUrl = `${SSO_URL}/api/auth/sso/authorize`
     + `?client_id=${encodeURIComponent(APP_ID)}`
     + `&redirect_uri=${encodeURIComponent(APP_URL + "/api/auth/callback")}`;

   <button onClick={() => window.location.href = ssoUrl}>透過 DF-SSO 登入</button>

6. 登出按鈕：

   <a href="/api/auth/logout">登出</a>
```

## 注意事項

- **Async vs sync**:`httpx.AsyncClient` 對齊 FastAPI 的 async-first 設計。若你的專案是純同步(例如 Flask 或用 `def` 而不是 `async def`),把 `httpx.AsyncClient` 換成 `httpx.Client`、把 router 的 `async def` 改成 `def`,其他邏輯完全一樣
- **Cookie secure 旗標**:`SsoSettings.is_secure` 依 `app_url` 協定自動決定;Prod `https://` 會自動打開,本機 `http://` 不會(否則瀏覽器不會送 cookie)
- **SameSite**:固定 `Lax`,對齊 [INTEGRATION.md](../../INTEGRATION.md)。跨 domain iframe 嵌入才需 `None`+`Secure`
- **`no_token` vs `session_expired`**:這個區分務必保留。前端看到 `no_token` 要自動導向 SSO(跨 App 免登入體驗),看到 `session_expired` 要顯示按鈕避免無限重導
- **back-channel logout 的 TODO**:若你用 Redis / DB 存 server-side session,在 `back_channel_logout` 裡要實際去清該 `user_id` 的 session,不然只是回 200 並沒有真的登出本地
- **HMAC constant-time compare**:`hmac.compare_digest` 是 Python 標準函式庫內建的 constant-time 比對,對齊 SSO backend 的 `crypto.timingSafeEqual`
- **pydantic-settings 版本**:範例用 Pydantic v2 的 `pydantic-settings`。若卡在 Pydantic v1,請改成 `from pydantic import BaseSettings` 並移除 `SettingsConfigDict`
- **HTTPX connection reuse**:為簡化,每次呼叫都新開 `AsyncClient`。若 SSO 呼叫量很大想共用連線池,可在 FastAPI `lifespan` 裡建立單一 `AsyncClient` 並注入,不影響本 skill 的其他邏輯
- 若 `{APP_DIR}/sso/` 目錄已存在同名檔案,詢問使用者是否覆蓋

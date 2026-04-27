# 初始化 SSO 登入器整合（Java Spring Boot）

在當前 Spring Boot 專案中自動建立 DF-SSO 登入器所需的所有檔案（Controller、Service、HMAC 驗章、Cookie 管理）。
**執行前會詢問必要資訊，之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的 4 個端點設計：`/callback`、`/me`、`/logout`、`/back-channel-logout`。
> 預設 **Spring Boot 3.x（Jakarta EE 9+）**。若是 Spring Boot 2.x 請把 `jakarta.servlet.*` 換成 `javax.servlet.*`。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器的網址
   - Prod：`https://df-sso-login.apps.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **App URL** — 你的專案網址（例如 `https://warehouse.apps.zerozero.tw`，本機 `http://localhost:8080`）
3. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
4. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元，保密）
5. **Base Package** — Spring Boot 專案的基礎 package（例如 `com.example.warehouse`）
6. **App Port** — 你的專案 Port（例如 `8080`）

## 前置檢查

執行前先確認：

- [ ] `pom.xml` 或 `build.gradle` 已含 `spring-boot-starter-web`（同步 HTTP + Controller）
- [ ] `pom.xml` 或 `build.gradle` 已含 `spring-boot-starter-webflux`（或至少 `reactor-netty`），用來取得 `WebClient`
  - 若偏好純同步，可改用 `RestTemplate`，下方 `SsoClient.java` 有替代寫法
- [ ] Java 17+

若缺，請先補上：

**Maven**：

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
```

**Gradle**：

```groovy
implementation 'org.springframework.boot:spring-boot-starter-webflux'
```

## 執行步驟

假設使用者填入的 base package 為 `{PKG}`，對應檔案路徑為 `src/main/java/{PKG_PATH}/sso/`，其中 `{PKG_PATH}` 為 `{PKG}` 把 `.` 換成 `/`（例如 `com.example.warehouse` → `com/example/warehouse`）。

### 1. 建立 `SsoProperties.java`

路徑：`src/main/java/{PKG_PATH}/sso/SsoProperties.java`

```java
package {PKG}.sso;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "sso")
public class SsoProperties {
    private String url;
    private String appId;
    private String appSecret;
    private String appUrl;
    private int timeoutMs = 8000;

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }

    public String getAppSecret() { return appSecret; }
    public void setAppSecret(String appSecret) { this.appSecret = appSecret; }

    public String getAppUrl() { return appUrl; }
    public void setAppUrl(String appUrl) { this.appUrl = appUrl; }

    public int getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
}
```

### 2. 建立 `SsoClient.java`（WebClient 版本）

路徑：`src/main/java/{PKG_PATH}/sso/SsoClient.java`

```java
package {PKG}.sso;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.handler.timeout.WriteTimeoutHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
public class SsoClient {

    private final WebClient webClient;
    private final SsoProperties props;

    @Autowired
    public SsoClient(SsoProperties props) {
        this.props = props;
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, props.getTimeoutMs())
                .responseTimeout(Duration.ofMillis(props.getTimeoutMs()))
                .doOnConnected(conn -> conn
                        .addHandlerLast(new ReadTimeoutHandler(props.getTimeoutMs(), TimeUnit.MILLISECONDS))
                        .addHandlerLast(new WriteTimeoutHandler(props.getTimeoutMs(), TimeUnit.MILLISECONDS)));

        this.webClient = WebClient.builder()
                .baseUrl(props.getUrl())
                .clientConnector(new org.springframework.http.client.reactive.ReactorClientHttpConnector(httpClient))
                .defaultHeader(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }

    /** 以 auth code 交換 SSO token（server-to-server，帶 client_secret）。 */
    public Map<String, Object> exchange(String code) {
        return webClient.post()
                .uri("/api/auth/sso/exchange")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of(
                        "code", code,
                        "client_id", props.getAppId(),
                        "client_secret", props.getAppSecret()))
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    /** 以 Bearer token 呼叫 SSO `/me`，回傳 user payload。 */
    public Map<String, Object> me(String token) {
        return webClient.get()
                .uri("/api/auth/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    /**
     * 通知 SSO 登出，並回傳 SSO 給的 Microsoft AD logout_url（包含 id_token_hint
     * 和 SSO post-logout 跳板）。Controller 必須把瀏覽器導向這個 URL，AD 才會清
     * 掉自己的 SSO cookie，否則使用者 Refresh 會被 AD 靜默重新登入。
     *
     * @param token  Bearer token
     * @param redirectAfter  AD 登出後最終要落地的 URL（必須在 sso_allowed_list）
     * @return logout_url；SSO 不可達或未回傳則回 null
     */
    @SuppressWarnings("unchecked")
    public String logout(String token, String redirectAfter) {
        try {
            Map<String, Object> body = webClient.post()
                    .uri("/api/auth/logout")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .bodyValue(Map.of("redirect", redirectAfter))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
            Object url = body == null ? null : body.get("logout_url");
            return url instanceof String s ? s : null;
        } catch (Exception ignored) {
            return null;
        }
    }
}
```

### 3. 建立 `SsoCookieUtil.java`

路徑：`src/main/java/{PKG_PATH}/sso/SsoCookieUtil.java`

```java
package {PKG}.sso;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseCookie;

public class SsoCookieUtil {

    public static final String TOKEN_COOKIE = "token";
    private static final int MAX_AGE_SECONDS = 24 * 60 * 60;

    private SsoCookieUtil() {}

    public static String readToken(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) {
            if (TOKEN_COOKIE.equals(c.getName())) return c.getValue();
        }
        return null;
    }

    public static void writeToken(HttpServletResponse res, String token, boolean secure) {
        ResponseCookie cookie = ResponseCookie.from(TOKEN_COOKIE, token)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/")
                .maxAge(MAX_AGE_SECONDS)
                .build();
        res.addHeader("Set-Cookie", cookie.toString());
    }

    public static void clearToken(HttpServletResponse res, boolean secure) {
        ResponseCookie cookie = ResponseCookie.from(TOKEN_COOKIE, "")
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
        res.addHeader("Set-Cookie", cookie.toString());
    }
}
```

### 4. 建立 `SsoAuthGuard.java` — Auth Middleware

**整個整合的核心**。所有 protected endpoint（包含 `/me` 本身）都必須透過這個 Guard，才能保證「中央 session 被撤銷後下一次呼叫立即失效」。

路徑：`src/main/java/{PKG_PATH}/sso/SsoAuthGuard.java`

```java
package {PKG}.sso;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.Map;

@Component
public class SsoAuthGuard {

    private static final Logger log = LoggerFactory.getLogger(SsoAuthGuard.class);

    private final SsoClient ssoClient;
    private final SsoProperties props;

    public SsoAuthGuard(SsoClient ssoClient, SsoProperties props) {
        this.ssoClient = ssoClient;
        this.props = props;
    }

    private boolean isSecure() {
        return props.getAppUrl() != null && props.getAppUrl().startsWith("https://");
    }

    /**
     * Protected endpoint 入口都呼叫這個：成功回 user map；失敗 throw SsoUnauthorizedException。
     * <p>
     * - no_token        → 401 + 無 token
     * - session_expired → 401 + 自動清本地 cookie
     * - sso_unreachable → 502（SSO 暫時不可達）
     */
    public Map<String, Object> requireAuth(HttpServletRequest req, HttpServletResponse res) {
        String token = SsoCookieUtil.readToken(req);
        if (token == null) {
            throw new SsoUnauthorizedException(SsoAuthError.NO_TOKEN);
        }

        Map<String, Object> payload;
        try {
            payload = ssoClient.me(token);
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 401) {
                SsoCookieUtil.clearToken(res, isSecure());
                throw new SsoUnauthorizedException(SsoAuthError.SESSION_EXPIRED);
            }
            throw new SsoUnauthorizedException(SsoAuthError.SSO_UNREACHABLE);
        } catch (Exception e) {
            log.warn("[SSO] /me failed: {}", e.getMessage());
            throw new SsoUnauthorizedException(SsoAuthError.SSO_UNREACHABLE);
        }

        if (payload == null || payload.get("user") == null) {
            throw new SsoUnauthorizedException(SsoAuthError.SSO_UNREACHABLE);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) payload.get("user");
        return user;
    }

    public enum SsoAuthError {
        NO_TOKEN(401, "no_token"),
        SESSION_EXPIRED(401, "session_expired"),
        SSO_UNREACHABLE(502, "sso_unreachable");

        public final int status;
        public final String code;

        SsoAuthError(int status, String code) {
            this.status = status;
            this.code = code;
        }
    }

    public static class SsoUnauthorizedException extends RuntimeException {
        public final SsoAuthError error;

        public SsoUnauthorizedException(SsoAuthError error) {
            super(error.code);
            this.error = error;
        }
    }
}
```

### 5. 建立 `SsoController.java`

路徑：`src/main/java/{PKG_PATH}/sso/SsoController.java`

```java
package {PKG}.sso;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@RestController
@RequestMapping("/api/auth")
public class SsoController {

    private static final Logger log = LoggerFactory.getLogger(SsoController.class);
    private static final long MAX_TIMESTAMP_DRIFT_MS = 30_000L;

    private final SsoClient ssoClient;
    private final SsoAuthGuard ssoAuthGuard;
    private final SsoProperties props;

    public SsoController(SsoClient ssoClient, SsoAuthGuard ssoAuthGuard, SsoProperties props) {
        this.ssoClient = ssoClient;
        this.ssoAuthGuard = ssoAuthGuard;
        this.props = props;
    }

    private boolean isSecure() {
        return props.getAppUrl() != null && props.getAppUrl().startsWith("https://");
    }

    private void redirect(HttpServletResponse res, String path) throws IOException {
        res.sendRedirect(URI.create(props.getAppUrl() + path).toString());
    }

    /** 1. OAuth callback：用 code 換 token，寫進 cookie，導回首頁 */
    @GetMapping("/callback")
    public void callback(@RequestParam(value = "code", required = false) String code,
                         HttpServletResponse res) throws IOException {
        if (code == null || code.isBlank()) {
            redirect(res, "/?error=no_code");
            return;
        }
        try {
            Map<String, Object> body = ssoClient.exchange(code);
            Object token = body == null ? null : body.get("token");
            if (!(token instanceof String t) || t.isBlank()) {
                redirect(res, "/?error=exchange_failed");
                return;
            }
            SsoCookieUtil.writeToken(res, t, isSecure());
            redirect(res, "/dashboard");
        } catch (Exception e) {
            log.warn("[SSO] exchange failed: {}", e.getMessage());
            redirect(res, "/?error=exchange_error");
        }
    }

    /**
     * 2. /me — 完全委託給 SsoAuthGuard。handler 只負責把 user 回給前端。
     *    失敗情境由全域 {@link SsoAuthExceptionHandler} 統一轉成 401/502。
     */
    @GetMapping("/me")
    public ResponseEntity<?> me(HttpServletRequest req, HttpServletResponse res) {
        Map<String, Object> user = ssoAuthGuard.requireAuth(req, res);
        return ResponseEntity.ok(Map.of("user", user));
    }

    /**
     * 3. /logout：通知 SSO，清 cookie，把瀏覽器導向 SSO 回傳的 AD logout_url
     *    （AD 清完自己的 SSO cookie 後會經 SSO post-logout 跳板回到 /?logged_out=1）。
     *    取不到 logout_url 時 fallback 直接回首頁。
     */
    @GetMapping("/logout")
    public void logout(HttpServletRequest req, HttpServletResponse res) throws IOException {
        String token = SsoCookieUtil.readToken(req);
        String fallback = props.getAppUrl() + "/?logged_out=1";
        String logoutUrl = null;
        if (token != null) logoutUrl = ssoClient.logout(token, fallback);
        SsoCookieUtil.clearToken(res, isSecure());
        if (logoutUrl != null) {
            // logoutUrl 是完整 URL（Microsoft endpoint），不可再前綴 app-url
            res.sendRedirect(logoutUrl);
        } else {
            redirect(res, "/?logged_out=1");
        }
    }

    /** 4. back-channel logout：SSO 廣播登出，驗 HMAC 後清自家 session */
    @PostMapping("/back-channel-logout")
    public ResponseEntity<?> backChannelLogout(@RequestBody Map<String, Object> body) {
        Object userIdObj = body.get("user_id");
        Object tsObj = body.get("timestamp");
        Object sigObj = body.get("signature");

        if (!(userIdObj instanceof String userId)
                || !(tsObj instanceof Number tsNum)
                || !(sigObj instanceof String signature)) {
            return ResponseEntity.badRequest().body(Map.of("error", "missing_fields"));
        }
        long timestamp = tsNum.longValue();

        // 驗 timestamp（防 replay）
        if (Math.abs(System.currentTimeMillis() - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "timestamp_expired"));
        }

        // 驗 HMAC-SHA256（constant-time compare）
        String expected;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.getAppSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal((userId + ":" + timestamp).getBytes(StandardCharsets.UTF_8));
            expected = HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "hmac_failed"));
        }

        byte[] sigBytes = signature.getBytes(StandardCharsets.UTF_8);
        byte[] expBytes = expected.getBytes(StandardCharsets.UTF_8);
        if (sigBytes.length != expBytes.length || !MessageDigest.isEqual(sigBytes, expBytes)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "invalid_signature"));
        }

        log.info("[SSO] Back-channel logout userId={}", userId);
        // TODO: 在這裡清掉該 user 在本 App 的 server-side session（若有）
        return ResponseEntity.ok(Map.of("success", true));
    }
}
```

### 6. 建立 `SsoAuthExceptionHandler.java` — 統一處理 SsoUnauthorizedException

路徑：`src/main/java/{PKG_PATH}/sso/SsoAuthExceptionHandler.java`

```java
package {PKG}.sso;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class SsoAuthExceptionHandler {

    @ExceptionHandler(SsoAuthGuard.SsoUnauthorizedException.class)
    public ResponseEntity<Map<String, String>> handle(SsoAuthGuard.SsoUnauthorizedException ex) {
        HttpStatus status = ex.error.status == 401 ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_GATEWAY;
        return ResponseEntity.status(status).body(Map.of("error", ex.error.code));
    }
}
```

> 這個 `@RestControllerAdvice` 會**同時接住** `/me` 以及所有其他 controller 呼叫 `ssoAuthGuard.requireAuth(...)` 時拋出的例外，統一回 `{"error": "no_token" | "session_expired" | "sso_unreachable"}`。Cookie 清除在 Guard 內已處理完畢。

### 7. 啟用 `@ConfigurationProperties`

路徑：`src/main/java/{PKG_PATH}/{MainApplication}.java`

在 Spring Boot 主程式加上：

```java
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import {PKG}.sso.SsoProperties;

@SpringBootApplication
@EnableConfigurationProperties(SsoProperties.class)
public class MainApplication { ... }
```

### 8. 更新 `application.yml`（或 `application.properties`）

**`application.yml`**（若使用）：

```yaml
sso:
  url: ${SSO_URL:http://localhost:3001}
  app-id: ${SSO_APP_ID:}
  app-secret: ${SSO_APP_SECRET:}
  app-url: ${APP_URL:http://localhost:{使用者填的 Port}}
  timeout-ms: 8000
```

**`application.properties`**（若使用）：

```properties
sso.url=${SSO_URL:http://localhost:3001}
sso.app-id=${SSO_APP_ID:}
sso.app-secret=${SSO_APP_SECRET:}
sso.app-url=${APP_URL:http://localhost:{使用者填的 Port}}
sso.timeout-ms=8000
```

### 9. 建立或更新 `.env`

在專案根目錄 `.env`（或 `env.local`、部署平台的環境變數）**追加**：

```
# DF-SSO 登入器
SSO_URL={使用者填的 SSO URL}
SSO_APP_ID={使用者填的 App ID}
SSO_APP_SECRET={使用者填的 App Secret}
APP_URL={使用者填的 App URL}
```

> ⚠️ `SSO_APP_SECRET` **絕不可** commit 進 git，也不可暴露給前端。
> ⚠️ Spring Boot 預設不自動讀 `.env`，請透過 shell、Docker、Coolify 或 [`spring-dotenv`](https://github.com/paulschwarz/spring-dotenv) 之類工具載入。

### 10. 顯示完成訊息

告知使用者：

```
✅ SSO 登入器整合完成（Java Spring Boot）！

已建立的檔案：
  src/main/java/{PKG_PATH}/sso/SsoProperties.java
  src/main/java/{PKG_PATH}/sso/SsoClient.java
  src/main/java/{PKG_PATH}/sso/SsoCookieUtil.java
  src/main/java/{PKG_PATH}/sso/SsoAuthGuard.java          — auth middleware（reusable）
  src/main/java/{PKG_PATH}/sso/SsoAuthExceptionHandler.java — 統一 401/502 回應
  src/main/java/{PKG_PATH}/sso/SsoController.java         — 4 個端點，/me 一行委託 Guard
  application.yml（或 .properties）— 已追加 sso.* 設定
  .env — 已追加 SSO 環境變數

📋 接下來你需要：

1. 確認 SSO Dashboard 的白名單：
   - 網域：{使用者填的 App URL}
   - Redirect URIs 要包含：{使用者填的 App URL}

2. 在 Spring Boot 主程式加上 @EnableConfigurationProperties(SsoProperties.class)

3. 所有需要登入的 protected controller 一律透過 SsoAuthGuard.requireAuth(...)：

   @RestController
   public class AssetsController {
       private final SsoAuthGuard ssoAuthGuard;

       public AssetsController(SsoAuthGuard ssoAuthGuard) {
           this.ssoAuthGuard = ssoAuthGuard;
       }

       @GetMapping("/api/assets")
       public ResponseEntity<?> list(HttpServletRequest req, HttpServletResponse res) {
           Map<String, Object> user = ssoAuthGuard.requireAuth(req, res);
           // user 保證已登入；每次呼叫都已向中央 Redis 確認 session
           return ResponseEntity.ok(Map.of(
               "viewer", user.get("email"),
               "assets", List.of()
           ));
       }
   }

   失敗時會拋 SsoUnauthorizedException，由 SsoAuthExceptionHandler
   統一轉成 {"error": "no_token"|"session_expired"|"sso_unreachable"} + 401/502。

4. 在你的登入頁（Thymeleaf / React / Vue 都可）加上按鈕：

   const SSO_URL  = "{使用者填的 SSO URL}";
   const APP_URL  = "{使用者填的 App URL}";
   const APP_ID   = "{使用者填的 App ID}";

   const ssoUrl = `${SSO_URL}/api/auth/sso/authorize`
     + `?client_id=${encodeURIComponent(APP_ID)}`
     + `&redirect_uri=${encodeURIComponent(APP_URL + "/api/auth/callback")}`;

   <button onClick={() => window.location.href = ssoUrl}>透過 DF-SSO 登入</button>

5. 在需要驗證的頁面呼叫：

   fetch("/api/auth/me", { credentials: "include" })
     .then(res => res.ok ? res.json() : Promise.reject())
     .then(data => setUser(data.user))
     .catch(() => window.location.href = ssoUrl);

6. 登出按鈕：

   <a href="/api/auth/logout">登出</a>
```

## 注意事項

- **Spring Boot 版本**：Boot 3.x = `jakarta.servlet.*`；Boot 2.x 請全部換成 `javax.servlet.*`
- **同步 vs 反應式**：`SsoClient` 使用 `WebClient` 但以 `.block()` 收斂成同步呼叫，因為 4 個端點都是一次性的短交互，不需要非同步
  - 若專案排斥 `webflux`，可改用 `RestTemplate`，`exchange`/`me`/`logout` 全部改成 `restTemplate.postForEntity(...)` / `getForEntity(...)` 即可，HMAC 驗章部分完全一樣
- **Secure cookie**：`isSecure()` 根據 `APP_URL` 協定自動決定；若 Prod 走 `https://` 一定要保留
- **SameSite**：固定 `Lax`（對齊 [INTEGRATION.md](../../INTEGRATION.md) 範例）；若要跨 domain iframe 嵌入才需 `None`+`Secure`
- **back-channel logout 的 TODO**：若你的 Spring Boot 本地保存了 server-side session（例如 Spring Session / Redis），在 `backChannelLogout` 裡要主動 invalidate 該 `userId` 的 session，不然單純回 200 不會真的清掉
- **HMAC constant-time compare**：`MessageDigest.isEqual(byte[], byte[])` 是 Java 內建的 constant-time 比對（對齊 SSO backend 的 `crypto.timingSafeEqual`）
- **Package 樣板替換**：`{PKG}` 請替換成使用者填的 base package（`com.example.warehouse`），`{PKG_PATH}` 是同一字串但 `.` → `/`
- 若 `src/main/java/{PKG_PATH}/sso/` 目錄已存在同名檔案，詢問使用者是否覆蓋

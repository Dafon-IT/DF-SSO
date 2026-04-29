# 初始化 SSO 登入器整合（Java Spring Boot）

在當前 Spring Boot 專案中自動建立 DF-SSO 登入器所需的所有 backend 檔案（Controller、Service、HMAC 驗章、Cookie 管理）。
**執行前會詢問必要資訊，之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的契約。**此 command 建立的是模式 A（純 SSO）的 backend**；登入頁與 401 攔截器在前端 SPA（React/Vue/Thymeleaf），完成訊息有對應片段。
> 預設 **Spring Boot 3.x（Jakarta EE 9+）**。若是 Spring Boot 2.x 請把 `jakarta.servlet.*` 換成 `javax.servlet.*`。

## 硬性契約（必看，漏一條就壞）

1. **`/me` 即時回源中央**：`SsoAuthGuard.requireAuth` 內每次都打中央 `/api/auth/me`，**禁止本地快取 user**
2. **登出 POST 中央 + 跟隨 redirect**：`/api/auth/logout` 必須先通知中央再清本地 cookie
3. **登入頁 401 顯示按鈕，不自動 redirect**：前端 SPA 的登入頁在 `/me` 401 時**只**顯示按鈕；自動 redirect 會破壞「登出真有效」
4. **Back-channel logout 必驗 HMAC + timestamp**：`MessageDigest.isEqual` + 30s drift；不註冊端點 比 註冊但不驗 還安全

完整契約見 [INTEGRATION.md](../../INTEGRATION.md)「硬性契約」與「Silent Re-Auth Pattern」。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器的網址
   - Prod：`https://df-it-sso-login.it.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **Backend URL** — 你的後端對外網址（callback 落點 + cookie host，例如 `https://api.warehouse.apps.zerozero.tw`，本機 `http://localhost:8080`）
3. **Frontend URL** — 你的前端對外網址（登入頁 / dashboard / logout fallback redirect 落點，例如 `https://warehouse.apps.zerozero.tw`，本機 `http://localhost:3000`）
   - 若前後端**同 origin**（例如 Thymeleaf monolith），填同一個 URL 即可
4. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
5. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元，保密）
6. **Base Package** — Spring Boot 專案的基礎 package（例如 `com.example.warehouse`）
7. **App Port** — 你的後端 Port（例如 `8080`）

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

`backendUrl` 是 callback 落點 + cookie host，`frontendUrl` 是登入頁 / dashboard / logout fallback。前後端同 origin 時兩者相等。

路徑：`src/main/java/{PKG_PATH}/sso/SsoProperties.java`

```java
package {PKG}.sso;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "sso")
public class SsoProperties {
    private String url;
    private String appId;
    private String appSecret;
    private String backendUrl;
    private String frontendUrl;
    private int timeoutMs = 8000;

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }

    public String getAppSecret() { return appSecret; }
    public void setAppSecret(String appSecret) { this.appSecret = appSecret; }

    public String getBackendUrl() { return backendUrl; }
    public void setBackendUrl(String backendUrl) { this.backendUrl = backendUrl; }

    public String getFrontendUrl() { return frontendUrl; }
    public void setFrontendUrl(String frontendUrl) { this.frontendUrl = frontendUrl; }

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

    /** 以 Bearer token 呼叫 SSO `/me`，回傳 user payload。契約 #1：每次都回源。 */
    public Map<String, Object> me(String token) {
        return webClient.get()
                .uri("/api/auth/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    /**
     * 通知 SSO 登出（兩層 Session 模型，契約 #2）：中央刪 Redis session + back-channel 通知所有 App。
     * AD session 完全不動。SSO 回傳已驗證 origin 的 redirect URL，Controller 把瀏覽器 302 過去即可。
     *
     * @param token  Bearer token
     * @param redirectAfter  登出後最終要落地的 URL（origin 必須在 sso_allowed_list）
     * @return SSO 驗證後的 redirect；SSO 不可達或未回傳則回 null
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
            Object url = body == null ? null : body.get("redirect");
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

### 4. 建立 `SsoAuthGuard.java` — Auth Middleware（契約 #1）

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
        return props.getBackendUrl() != null && props.getBackendUrl().startsWith("https://");
    }

    /**
     * Protected endpoint 入口都呼叫這個：成功回 user map；失敗 throw SsoUnauthorizedException。
     * <ul>
     *   <li>no_token        → 401（前端跳登入頁顯示按鈕）</li>
     *   <li>session_expired → 401 + 自動清本地 cookie（前端走 silent re-auth）</li>
     *   <li>sso_unreachable → 502（不刪 cookie，避免抖動踢人）</li>
     * </ul>
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
    private static final long MAX_TIMESTAMP_DRIFT_MS = 30_000L; // 雙向 abs

    private final SsoClient ssoClient;
    private final SsoAuthGuard ssoAuthGuard;
    private final SsoProperties props;

    public SsoController(SsoClient ssoClient, SsoAuthGuard ssoAuthGuard, SsoProperties props) {
        this.ssoClient = ssoClient;
        this.ssoAuthGuard = ssoAuthGuard;
        this.props = props;
    }

    private boolean isSecure() {
        return props.getBackendUrl() != null && props.getBackendUrl().startsWith("https://");
    }

    private void redirectFrontend(HttpServletResponse res, String path) throws IOException {
        res.sendRedirect(URI.create(props.getFrontendUrl() + path).toString());
    }

    /** 1. OAuth callback：用 code 換 token，寫進 cookie，導回 frontend dashboard */
    @GetMapping("/callback")
    public void callback(@RequestParam(value = "code", required = false) String code,
                         HttpServletResponse res) throws IOException {
        if (code == null || code.isBlank()) {
            redirectFrontend(res, "/?error=no_code");
            return;
        }
        try {
            Map<String, Object> body = ssoClient.exchange(code);
            Object token = body == null ? null : body.get("token");
            if (!(token instanceof String t) || t.isBlank()) {
                redirectFrontend(res, "/?error=exchange_failed");
                return;
            }
            SsoCookieUtil.writeToken(res, t, isSecure());
            redirectFrontend(res, "/dashboard");
        } catch (Exception e) {
            log.warn("[SSO] exchange failed: {}", e.getMessage());
            redirectFrontend(res, "/?error=exchange_error");
        }
    }

    /**
     * 2. /me — 完全委託給 SsoAuthGuard。失敗由 {@link SsoAuthExceptionHandler} 統一轉成 401/502。
     */
    @GetMapping("/me")
    public ResponseEntity<?> me(HttpServletRequest req, HttpServletResponse res) {
        Map<String, Object> user = ssoAuthGuard.requireAuth(req, res);
        return ResponseEntity.ok(Map.of("user", user));
    }

    /**
     * 3. /logout（兩層 Session 模型，契約 #2）：
     *    通知 SSO 刪中央 session + back-channel 通知所有 App，清本地 cookie，導向 SSO 回傳的 redirect。
     *    AD session 不動。取不到 redirect 時 fallback 回 frontend 首頁帶 ?logged_out=1。
     */
    @GetMapping("/logout")
    public void logout(HttpServletRequest req, HttpServletResponse res) throws IOException {
        String token = SsoCookieUtil.readToken(req);
        String fallback = props.getFrontendUrl() + "/?logged_out=1";
        String redirectUrl = null;
        if (token != null) redirectUrl = ssoClient.logout(token, fallback);
        // 不論成功與否：同一 response 刪 cookie
        SsoCookieUtil.clearToken(res, isSecure());
        if (redirectUrl != null) {
            // redirectUrl 是完整 URL（已含 path/query），不可再前綴 frontend-url
            res.sendRedirect(redirectUrl);
        } else {
            redirectFrontend(res, "/?logged_out=1");
        }
    }

    /** 4. back-channel logout（契約 #4）：SSO 廣播登出，驗 HMAC 後清自家 session */
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

        // 驗 timestamp（防 replay，雙向 abs）
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
        // TODO: 模式 A 純 SSO 通常不需動作；若有 in-process 快取 / WebSocket / Spring Session，在這裡 invalidate userId
        return ResponseEntity.ok(Map.of("success", true));
    }
}
```

### 6. 建立 `SsoAuthExceptionHandler.java`

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

> 這個 `@RestControllerAdvice` 會**同時接住** `/me` 以及所有其他 controller 呼叫 `ssoAuthGuard.requireAuth(...)` 時拋出的例外，統一回 `{"error": "no_token" | "session_expired" | "sso_unreachable"}`。

### 7. 建立 `SsoCorsConfig.java` — 前後端分離必設

路徑：`src/main/java/{PKG_PATH}/sso/SsoCorsConfig.java`

```java
package {PKG}.sso;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

@Configuration
public class SsoCorsConfig {

    private final SsoProperties props;

    public SsoCorsConfig(SsoProperties props) {
        this.props = props;
    }

    @Bean
    public CorsFilter ssoCorsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(props.getFrontendUrl()));
        config.setAllowCredentials(true); // 允許帶 cookie
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
```

> 若 `frontendUrl == backendUrl`（同 origin），這個 bean 仍可保留，不會有副作用。

### 8. 啟用 `@ConfigurationProperties`

路徑：`src/main/java/{PKG_PATH}/{MainApplication}.java`

```java
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import {PKG}.sso.SsoProperties;

@SpringBootApplication
@EnableConfigurationProperties(SsoProperties.class)
public class MainApplication { ... }
```

### 9. 更新 `application.yml`（或 `application.properties`）

**`application.yml`**（若使用）：

```yaml
sso:
  url: ${SSO_URL:http://localhost:3001}
  app-id: ${SSO_APP_ID:}
  app-secret: ${SSO_APP_SECRET:}
  backend-url: ${BACKEND_URL:http://localhost:{使用者填的 Port}}
  frontend-url: ${FRONTEND_URL:http://localhost:{使用者填的 Port}}
  timeout-ms: 8000
```

**`application.properties`**（若使用）：

```properties
sso.url=${SSO_URL:http://localhost:3001}
sso.app-id=${SSO_APP_ID:}
sso.app-secret=${SSO_APP_SECRET:}
sso.backend-url=${BACKEND_URL:http://localhost:{使用者填的 Port}}
sso.frontend-url=${FRONTEND_URL:http://localhost:{使用者填的 Port}}
sso.timeout-ms=8000
```

### 10. 建立或更新 `.env`

在專案根目錄 `.env`（或 `env.local`、部署平台的環境變數）**追加**：

```
# DF-SSO 登入器
SSO_URL={使用者填的 SSO URL}
SSO_APP_ID={使用者填的 App ID}
SSO_APP_SECRET={使用者填的 App Secret}
BACKEND_URL={使用者填的 Backend URL}
FRONTEND_URL={使用者填的 Frontend URL}
```

> ⚠️ `SSO_APP_SECRET` **絕不可** commit 進 git，也不可暴露給前端。
> ⚠️ Spring Boot 預設不自動讀 `.env`，請透過 shell、Docker、Coolify 或 [`spring-dotenv`](https://github.com/paulschwarz/spring-dotenv) 之類工具載入。
> ⚠️ SSO Dashboard 的 `redirect_uris` 註冊的是 callback 的 origin = **BACKEND_URL**，不是 frontend。

### 11. 顯示完成訊息

```
✅ SSO 登入器整合完成（Spring Boot / 模式 A 純 SSO）！

已建立的檔案：
  src/main/java/{PKG_PATH}/sso/SsoProperties.java        — backendUrl + frontendUrl 兩個 origin
  src/main/java/{PKG_PATH}/sso/SsoClient.java            — server-to-server 呼叫 SSO 中央
  src/main/java/{PKG_PATH}/sso/SsoCookieUtil.java
  src/main/java/{PKG_PATH}/sso/SsoAuthGuard.java         — auth middleware（契約 #1）
  src/main/java/{PKG_PATH}/sso/SsoAuthExceptionHandler.java — 統一 401/502 回應
  src/main/java/{PKG_PATH}/sso/SsoController.java        — 4 個 backend 端點
  src/main/java/{PKG_PATH}/sso/SsoCorsConfig.java        — allow_credentials + 白名單前端 origin
  application.yml（或 .properties）— 已追加 sso.* 設定
  .env — 已追加 SSO 環境變數

📋 接下來你需要：

1. 確認 SSO Dashboard 的白名單：
   - 網域：{使用者填的 Backend URL}（callback 落點）
   - Redirect URIs 要包含：{使用者填的 Backend URL}
   - 若 BACKEND_URL ≠ FRONTEND_URL，FRONTEND_URL 也要加進 redirect_uris（logout fallback 落點驗證）

2. 在 Spring Boot 主程式加上 @EnableConfigurationProperties(SsoProperties.class)

3. 所有需要登入的 protected controller 一律透過 SsoAuthGuard.requireAuth(...)：

   @RestController
   public class AssetsController {
       private final SsoAuthGuard ssoAuthGuard;
       public AssetsController(SsoAuthGuard g) { this.ssoAuthGuard = g; }

       @GetMapping("/api/assets")
       public ResponseEntity<?> list(HttpServletRequest req, HttpServletResponse res) {
           Map<String, Object> user = ssoAuthGuard.requireAuth(req, res);
           // 每次呼叫都已向中央 Redis 確認 session
           return ResponseEntity.ok(Map.of("viewer", user.get("email"), "assets", List.of()));
       }
   }

   失敗時拋 SsoUnauthorizedException，由 SsoAuthExceptionHandler 統一轉成
   {"error": "no_token"|"session_expired"|"sso_unreachable"} + 401/502。

4. 前端 SPA（React/Vue/Thymeleaf 都可）需實作：

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

- **Spring Boot 版本**：Boot 3.x = `jakarta.servlet.*`；Boot 2.x 請全部換成 `javax.servlet.*`
- **同步 vs 反應式**：`SsoClient` 使用 `WebClient` 但以 `.block()` 收斂成同步呼叫，因為 4 個端點都是一次性的短交互，不需要非同步
  - 若專案排斥 `webflux`，可改用 `RestTemplate`，HMAC 驗章部分完全一樣
- **Secure cookie**：依 `backendUrl` 協定自動決定；Prod `https://` 一定要保留
- **SameSite**：固定 `Lax`，對齊 [INTEGRATION.md](../../INTEGRATION.md)；跨 domain iframe 嵌入才需 `None`+`Secure`
- **登入頁 vs dashboard 401 處理不一樣**：登入頁（契約 #3）禁止自動 redirect；dashboard 工作中（silent re-auth）必須自動 redirect。前端 SPA 兩個邏輯要分清楚
- **CORS allow_credentials**：前後端不同 origin 時是必要條件；缺一行就會「fetch 200 但前端拿不到 cookie」。`allowedOrigins` 不可用 `"*"`，必須白名單列出實際前端 origin
- **back-channel logout 的 TODO**：模式 A 純 SSO 通常不需動作；若你用 Spring Session / Redis 存 server-side session，要主動 invalidate 該 `userId`。**保留無驗證的端點 比 不註冊還糟**——前者騙系統有保護
- **HMAC constant-time compare**：`MessageDigest.isEqual(byte[], byte[])` 是 Java 內建的 constant-time 比對，對齊 SSO backend 的 `crypto.timingSafeEqual`
- **Package 樣板替換**：`{PKG}` 請替換成使用者填的 base package（`com.example.warehouse`），`{PKG_PATH}` 是同一字串但 `.` → `/`
- **模式 B（本地帳密 + SSO）**：JWT payload 加 `provider` claim、`SsoAuthGuard` 依 `provider` 分流（SSO → 本流程；local → 查自家 session store）。本 command 不自動建立模式 B；細節見 [INTEGRATION.md](../../INTEGRATION.md)「模式 B」
- 若 `src/main/java/{PKG_PATH}/sso/` 目錄已存在同名檔案，詢問使用者是否覆蓋

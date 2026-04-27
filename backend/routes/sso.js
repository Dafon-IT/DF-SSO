import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import redis from '../config/redis.js';
import allowedListService from '../services/allowedList.js';
import { buildMicrosoftLogoutUrl } from '../services/microsoftLogout.js';

const router = express.Router();

const SESSION_PREFIX = 'sso:session:';
const AUTH_CODE_PREFIX = 'sso:code:';
const AUTH_CODE_TTL = 60; // 一次性授權碼有效期 60 秒

/**
 * GET /api/auth/sso/authorize?client_id=<app_id>&redirect_uri=<url>
 * SSO 授權端點（OAuth2 Authorization Code Flow）：
 * - 用 client_id (app_id) 查詢白名單
 * - 驗證 redirect_uri 的 origin 是否在該 App 的 redirect_uris 中
 * - 已有中央 session → 產生一次性 auth code，帶 code 重導到 redirect_uri
 * - 無 session → 走 Microsoft 登入，登入後重導到 redirect_uri
 */
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri } = req.query;

  if (!client_id || !redirect_uri) {
    return res.status(400).json({ error: 'Missing client_id or redirect_uri' });
  }

  // 用 app_id 查白名單
  const app = await allowedListService.findByAppId(client_id);
  if (!app) {
    return res.status(403).json({ error: 'Invalid client_id' });
  }

  // 驗證 redirect_uri 的 origin 是否在已註冊的 redirect_uris 中
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect_uri);
    const uris = app.redirect_uris || [];
    if (!uris.includes(redirectUrl.origin)) {
      console.warn(`Blocked redirect_uri origin: ${redirectUrl.origin} for app: ${client_id}`);
      return res.status(403).json({
        error: 'redirect_uri is not registered for this app',
      });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid redirect_uri' });
  }

  // 檢查是否已有中央 session
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
      if (sessionStr) {
        // 已登入，產生一次性 auth code
        const code = crypto.randomBytes(32).toString('hex');
        let sessionData;
        try {
          sessionData = JSON.parse(sessionStr);
        } catch {
          return res.status(401).json({ error: 'Invalid session' });
        }

        await redis.set(
          `${AUTH_CODE_PREFIX}${code}`,
          JSON.stringify({
            userId: sessionData.userId,
            email: sessionData.email,
            name: sessionData.name,
            erpData: sessionData.erpData,
          }),
          'EX',
          AUTH_CODE_TTL
        );

        // 刷新 token cookie（確保帶上最新的 domain 設定）
        res.cookie('token', token, {
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000,
          ...(config.cookieDomain && { domain: config.cookieDomain }),
        });

        // 帶 code 重導回 client app
        redirectUrl.searchParams.set('code', code);
        return res.redirect(redirectUrl.toString());
      }
    } catch {
      // token 無效，繼續走登入
    }
  }

  // 未登入，記住要導回的位置，走 Microsoft 登入
  req.session.ssoRedirect = redirect_uri;
  res.redirect(`/api/auth/${config.azure.authPathSegment}/login`);
});

/**
 * POST /api/auth/sso/exchange
 * Auth Code 交換端點（server-to-server，OAuth2 Token Endpoint）：
 * Client App 後端用一次性 auth code + client credentials 換取用戶資料 + JWT token
 * 使用 Lua script 確保原子性（防止 race condition 重複使用）
 */
router.post('/exchange', async (req, res) => {
  const { code, client_id, client_secret } = req.body;

  if (!code || typeof code !== 'string' || code.length !== 64) {
    return res.status(400).json({ error: 'Invalid code format' });
  }

  // 驗證 client credentials
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing client_id or client_secret' });
  }

  const app = await allowedListService.findByAppId(client_id);
  if (
    !app || !client_secret ||
    typeof client_secret !== 'string' ||
    client_secret.length !== app.app_secret.length ||
    !crypto.timingSafeEqual(Buffer.from(app.app_secret), Buffer.from(client_secret))
  ) {
    return res.status(401).json({ error: 'Invalid client credentials' });
  }

  const key = `${AUTH_CODE_PREFIX}${code}`;

  // 使用 Lua script 原子性地 GET + DEL（防止 race condition）
  const luaScript = `
    local val = redis.call('GET', KEYS[1])
    if val then
      redis.call('DEL', KEYS[1])
    end
    return val
  `;

  const dataStr = await redis.eval(luaScript, 1, key);

  if (!dataStr) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  let userData;
  try {
    userData = JSON.parse(dataStr);
  } catch {
    return res.status(500).json({ error: 'Invalid session data' });
  }

  // 產生 JWT token 給 Client App 存儲（用於後續呼叫 /api/auth/me）
  const token = jwt.sign(
    { userId: userData.userId, email: userData.email, name: userData.name },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
  );

  res.json({ user: userData, token });
});

/**
 * GET /api/auth/sso/logout?redirect=<url>
 * 全域登出（瀏覽器入口）：
 *   1. 清除中央 session + token cookie
 *   2. Back-channel 通知所有 client app
 *   3. 導向 Microsoft AD end_session_endpoint，由 AD 清掉自己的 SSO cookie
 *      → AD 完成後會帶 redirect 到 /api/auth/sso/post-logout，再由跳板導回最終 redirect
 *
 * redirect 參數的 origin 必須在 sso_allowed_list（防開放重導向攻擊）
 */
router.get('/logout', async (req, res) => {
  const { redirect } = req.query;
  const token = req.cookies.token;

  let userId = null;
  let microsoftIdToken = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      userId = decoded.userId;

      // 在刪除前先讀出 id_token（給 AD logout 用作 id_token_hint）
      const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
      if (sessionStr) {
        try {
          microsoftIdToken = JSON.parse(sessionStr).microsoftIdToken || null;
        } catch {
          // ignore
        }
      }

      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch {
      // token 無效，繼續清除 cookie
    }
  }

  // Back-channel Logout：通知所有已註冊的 client app（帶 HMAC 簽章防偽造）
  if (userId) {
    try {
      const apps = await allowedListService.getAllAppsForBackChannel();
      const timestamp = Date.now();
      const backChannelPromises = apps
        .filter(({ origin }) => origin !== config.frontendUrl)
        .map(({ origin, appSecret }) => {
          const signature = crypto
            .createHmac('sha256', appSecret)
            .update(`${userId}:${timestamp}`)
            .digest('hex');
          return fetch(`${origin}/api/auth/back-channel-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, timestamp, signature }),
            signal: AbortSignal.timeout(5000),
          }).catch((err) => {
            console.warn(`Back-channel logout to ${origin} failed:`, err.message);
          });
        });
      await Promise.allSettled(backChannelPromises);
    } catch (err) {
      console.error('Back-channel logout error:', err.message);
    }
  }

  res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });

  // 驗證 redirect 是否在已註冊的 redirect_uris 中（僅允許已知 origin，禁止任意 path）
  let safeRedirect = config.frontendUrl;
  if (redirect) {
    try {
      const parsed = new URL(redirect);
      // 只允許 http/https 協定，防止 javascript: 等協定注入
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.warn(`Blocked redirect with disallowed protocol: ${parsed.protocol}`);
      } else {
        const redirectOrigin = parsed.origin;
        const origins = await allowedListService.getAllOrigins();
        if (origins.includes(redirectOrigin) || redirectOrigin === config.frontendUrl) {
          // 只保留 origin（剝除攻擊者可能注入的 path/query/fragment）
          safeRedirect = redirectOrigin;
        } else {
          console.warn(`Blocked redirect to unauthorized origin: ${redirectOrigin}`);
        }
      }
    } catch {
      console.warn('Invalid redirect URL in logout request');
    }
  }

  // 導向 Microsoft AD end_session_endpoint（清 AD SSO cookie），AD 會接著導回 /post-logout 跳板
  res.redirect(buildMicrosoftLogoutUrl(microsoftIdToken, safeRedirect));
});

/**
 * GET /api/auth/sso/post-logout?redirect=<url>
 * AD 登出跳板：Microsoft 登出 AAD session 後會把瀏覽器導回這裡。
 *
 * 為什麼存在：
 *   Microsoft 規定 post_logout_redirect_uri 必須事先在 Azure App Registration
 *   「Front-channel logout URL」註冊。我們只把 SSO 自己的這個 endpoint 註冊到
 *   Azure，實際各 Client App 的最終目的地由本端讀 sso_allowed_list 動態驗證後再導過去。
 *   這樣維持「sso_allowed_list 是單一事實來源」的設計慣例，新增 Web App 不用動 Azure。
 *
 * 安全：redirect origin 必須在 sso_allowed_list（與 /logout 同樣的驗證邏輯）
 */
router.get('/post-logout', async (req, res) => {
  const { redirect } = req.query;

  let safeRedirect = config.frontendUrl;
  if (redirect && typeof redirect === 'string') {
    try {
      const parsed = new URL(redirect);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.warn(`Blocked post-logout redirect with disallowed protocol: ${parsed.protocol}`);
      } else {
        const origins = await allowedListService.getAllOrigins();
        if (origins.includes(parsed.origin) || parsed.origin === config.frontendUrl) {
          // 保留完整 redirect（包含 path/query），方便 Client App 帶 ?logged_out=1 之類旗標
          safeRedirect = redirect;
        } else {
          console.warn(`Blocked post-logout redirect to unauthorized origin: ${parsed.origin}`);
        }
      }
    } catch {
      console.warn('Invalid redirect URL in post-logout request');
    }
  }

  res.redirect(safeRedirect);
});

export default router;

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const allowedListService = require('../services/allowedList');

const router = express.Router();

const SESSION_PREFIX = 'sso:session:';
const AUTH_CODE_PREFIX = 'sso:code:';
const AUTH_CODE_TTL = 60; // 一次性授權碼有效期 60 秒

/**
 * GET /api/auth/sso/authorize?app=<name>&redirect_uri=<url>
 * SSO 授權端點：
 * - 用 app (白名單 name) 查詢，驗證 redirect_uri 的 origin 是否與該筆白名單 domain 匹配
 * - 已有中央 session → 產生一次性 auth code，帶 code 重導到 redirect_uri
 * - 無 session → 走 Microsoft 登入，登入後重導到 redirect_uri
 */
router.get('/authorize', async (req, res) => {
  const { app, redirect_uri } = req.query;

  if (!app || !redirect_uri) {
    return res.status(400).json({ error: 'Missing app or redirect_uri' });
  }

  // 用 name 查白名單
  const allowed = await allowedListService.findByName(app);
  if (!allowed) {
    return res.status(403).json({ error: `App "${app}" not found or not active in allowed list` });
  }

  // 驗證 redirect_uri 的 origin 是否與白名單中的 domain 匹配
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect_uri);
    if (redirectUrl.origin !== allowed.domain) {
      return res.status(403).json({
        error: `redirect_uri origin "${redirectUrl.origin}" does not match registered domain "${allowed.domain}"`,
      });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid redirect_uri' });
  }

  // 檢查是否已有中央 session
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
      if (sessionStr) {
        // 已登入，產生一次性 auth code
        const code = crypto.randomBytes(32).toString('hex');
        const sessionData = JSON.parse(sessionStr);

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
 * Auth Code 交換端點（server-to-server）：
 * Client App 後端用一次性 auth code 換取用戶資料 + JWT token
 */
router.post('/exchange', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  // 從 Redis 取出並刪除 auth code（一次性使用）
  const key = `${AUTH_CODE_PREFIX}${code}`;
  const dataStr = await redis.get(key);

  if (!dataStr) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  // 立即刪除，確保一次性使用
  await redis.del(key);

  const userData = JSON.parse(dataStr);

  // 產生 JWT token 給 Client App 存儲（用於後續呼叫 /api/auth/me）
  const token = jwt.sign(
    { userId: userData.userId, email: userData.email, name: userData.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  res.json({ user: userData, token });
});

/**
 * GET /api/auth/sso/logout?redirect=<url>
 * 全域登出：清除中央 session + token cookie，back-channel 通知所有 client app，重導到指定頁面
 */
router.get('/logout', async (req, res) => {
  const { redirect } = req.query;
  const token = req.cookies.token;

  let userId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      userId = decoded.userId;
      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch {
      // token 無效，繼續清除 cookie
    }
  }

  // Back-channel Logout：通知所有啟用的 client app
  if (userId) {
    try {
      const allowedDomains = await allowedListService.findAll();
      const backChannelPromises = allowedDomains
        .filter((d) => d.domain !== config.frontendUrl) // 排除 SSO Frontend 自己
        .map((d) =>
          fetch(`${d.domain}/api/auth/back-channel-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
            signal: AbortSignal.timeout(5000),
          }).catch((err) => {
            console.warn(`Back-channel logout to ${d.domain} failed:`, err.message);
          })
        );
      await Promise.allSettled(backChannelPromises);
    } catch (err) {
      console.error('Back-channel logout error:', err.message);
    }
  }

  res.clearCookie('token');
  res.redirect(redirect || config.frontendUrl);
});

module.exports = router;

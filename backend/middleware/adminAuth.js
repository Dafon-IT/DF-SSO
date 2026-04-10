const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const adminManager = require('../services/adminManager');

const SESSION_PREFIX = 'sso:session:';

/**
 * 管理員驗證中間件
 * 驗證 JWT token → Redis session → 管理員名單
 */
async function adminAuth(req, res, next) {
  let token = req.cookies.token;
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
    if (!sessionStr) {
      return res.status(401).json({ error: 'Session expired' });
    }

    let session;
    try {
      session = JSON.parse(sessionStr);
    } catch {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const isAdmin = await adminManager.isAdmin(session.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = session;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = adminAuth;

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const swaggerSpec = require('./config/swagger');
const authRoutes = require('./routes/auth');
const ssoRoutes = require('./routes/sso');
const allowedListRoutes = require('./routes/allowedList');
const loginLogRoutes = require('./routes/loginLog');
const adminManagerRoutes = require('./routes/adminManager');
const ssoSettingRoutes = require('./routes/ssoSetting');
const allowedListService = require('./services/allowedList');
const rateLimitManager = require('./services/rateLimitManager');
const adminAuth = require('./middleware/adminAuth');

// 初始化連線
const db = require('./config/database');
const redis = require('./config/redis');

const app = express();

// Reverse proxy (Coolify/Nginx) 會設定 X-Forwarded-For
app.set('trust proxy', 1);

// ============================================
// 安全中間件
// ============================================

// Helmet：設定安全 HTTP headers
app.use(helmet({
  contentSecurityPolicy: false, // Next.js 前端需要 inline scripts
  crossOriginEmbedderPolicy: false,
}));

// Request logging
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Body size limit（防止大 payload DoS）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Cookie parser
app.use(cookieParser());

// ============================================
// Rate Limiting（設定存於 sso_setting 表，啟動後由 rateLimitManager 動態載入）
// ============================================

const {
  globalLimiter,
  authLimiter,
  sessionLimiter,
  exchangeLimiter,
} = rateLimitManager;

app.use(globalLimiter);

// ============================================
// CORS（從 DB 白名單動態載入）
// ============================================

let corsOriginsCache = [];
let corsCacheTime = 0;
const CORS_CACHE_TTL = 60 * 1000; // 1 分鐘快取

async function loadCorsOrigins() {
  const now = Date.now();
  if (now - corsCacheTime < CORS_CACHE_TTL && corsOriginsCache.length > 0) {
    return corsOriginsCache;
  }
  try {
    const dbOrigins = await allowedListService.getAllOrigins();
    // SSO Frontend 自身永遠允許 CORS
    corsOriginsCache = [...new Set([config.frontendUrl, ...dbOrigins])];
    corsCacheTime = now;
  } catch (err) {
    console.error('Failed to load CORS origins from DB:', err.message);
  }
  return corsOriginsCache;
}

app.use(cors({
  origin: async function (origin, callback) {
    // 允許無 origin 的請求（如 server-to-server 的 exchange 呼叫）
    if (!origin) return callback(null, true);
    const origins = await loadCorsOrigins();
    if (origins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
}));

// ============================================
// Session
// ============================================

app.use(session({
  store: new RedisStore({ client: redis, prefix: 'sess:' }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 分鐘（僅用於 OAuth state）
  },
}));

// ============================================
// Swagger API 文件
// ============================================

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'DF-SSO API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// ============================================
// Routes（搭配 rate limiting）
// ============================================

app.use('/api/auth/me', sessionLimiter);
app.use('/api/auth/logout', sessionLimiter);
app.use('/api/auth/sso/exchange', exchangeLimiter);
app.use('/api/auth/sso', authLimiter, ssoRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/allowed-list', adminAuth, allowedListRoutes);
app.use('/api/login-log', adminAuth, loginLogRoutes);
app.use('/api/admin-manager', adminAuth, adminManagerRoutes);
// 後台 CRUD 為低頻操作，沿用預設 globalLimiter 即可
app.use('/api/sso-setting', adminAuth, ssoSettingRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', timestamp: new Date().toISOString() };

  try {
    await db.query('SELECT 1');
    health.pg = 'connected';
  } catch {
    health.pg = 'disconnected';
    health.status = 'degraded';
  }

  try {
    await redis.ping();
    health.redis = 'connected';
  } catch {
    health.redis = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ============================================
// Global Error Handler
// ============================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler（CORS errors、unexpected errors）
app.use((err, req, res, _next) => {
  // CORS 錯誤
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS request not allowed' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// 啟動伺服器
// ============================================

const server = app.listen(config.port, () => {
  console.log(`DF-SSO Backend running on http://localhost:${config.port} [${config.nodeEnv}]`);
  // 從 sso_setting 表載入 rate limit 設定覆蓋預設值
  rateLimitManager.reload().then((ok) => {
    if (ok) console.log('Rate limit settings loaded from sso_setting table');
  });
});

// ============================================
// Graceful Shutdown
// ============================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await db.end();
      console.log('PostgreSQL pool closed');
    } catch { /* ignore */ }
    try {
      redis.disconnect();
      console.log('Redis disconnected');
    } catch { /* ignore */ }
    process.exit(0);
  });

  // 強制關閉（10 秒後）
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

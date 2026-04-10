/**
 * 集中管理所有環境變數設定
 * 所有模組應透過此 config 取得設定值，不可直接讀取 process.env
 */
const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Session
  sessionSecret: process.env.SESSION_SECRET,

  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

  // Microsoft Azure AD
  azure: {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    tenantId: process.env.AZURE_TENANT_ID,
    redirectUri: process.env.AZURE_REDIRECT_URI,
    // 從 AZURE_REDIRECT_URI 解析 auth path segment（/api/auth/{segment}/redirect）
    authPathSegment: (() => {
      try {
        const url = new URL(process.env.AZURE_REDIRECT_URI);
        const parts = url.pathname.split('/');
        // 路徑格式: /api/auth/{segment}/redirect
        const authIndex = parts.indexOf('auth');
        return authIndex !== -1 ? parts[authIndex + 1] : 'microsoft';
      } catch {
        return 'microsoft';
      }
    })(),
  },

  // Cookie domain（設定後 token cookie 會在所有子網域共用，例如 .apps.zerozero.tw）
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,

  // Login redirect
  loginRedirectUrl: process.env.ROPC_REDIRECT_URL || '/',

  // PostgreSQL
  pg: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT, 10) || 5432,
    database: process.env.PG_DATABASE,
    schema: process.env.PG_SCHEMA || 'public',
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  // ERP API
  erp: {
    loginUrl: process.env.ERP_API_LOGIN_URL,
    searchUrl: process.env.ERP_API_SEARCH_URL,
    account: process.env.ERP_API_ACCOUNT,
    password: process.env.ERP_API_PASSWORD,
  },
};

// ============================================
// 啟動時驗證必要環境變數
// ============================================

const required = [
  ['SESSION_SECRET', config.sessionSecret],
  ['JWT_SECRET', config.jwtSecret],
  ['AZURE_CLIENT_ID', config.azure.clientId],
  ['AZURE_CLIENT_SECRET', config.azure.clientSecret],
  ['AZURE_TENANT_ID', config.azure.tenantId],
  ['AZURE_REDIRECT_URI', config.azure.redirectUri],
  ['PG_DATABASE', config.pg.database],
  ['PG_USER', config.pg.user],
  ['PG_PASSWORD', config.pg.password],
];

const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables:\n   ${missing.join('\n   ')}\n`);
  process.exit(1);
}

module.exports = config;

const { Pool } = require('pg');
const config = require('./index');

const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
});

// 連線後設定 search_path（使用白名單驗證，防止 SQL injection）
pool.on('connect', (client) => {
  const schema = config.pg.schema;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name: ${schema}`);
  }
  client.query(`SET search_path TO ${schema}`);
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected error:', err.message);
});

module.exports = pool;

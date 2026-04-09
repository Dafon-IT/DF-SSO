const { Pool } = require('pg');
const config = require('./index');

const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
});

// 連線後設定 search_path
pool.on('connect', (client) => {
  client.query(`SET search_path TO ${config.pg.schema}`);
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected error:', err.message);
});

module.exports = pool;

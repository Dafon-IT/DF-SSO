exports.shorthands = undefined;

exports.up = (pgm) => {
  // 刪除錯誤新增的 login domain
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain = 'https://df-sso-login.apps.zerozero.tw'
  `);

  // 確保 management domain 存在
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, env, description)
    VALUES
      ('https://df-sso-management.apps.zerozero.tw', 'SSO Management', 'test', 'DF-SSO 管理後台 (Test)')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain = 'https://df-sso-management.apps.zerozero.tw'
  `);
};

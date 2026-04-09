exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, env, description)
    VALUES
      ('https://df-sso-login.apps.zerozero.tw', 'SSO Login', 'test', 'DF-SSO Login (Test)'),
      ('https://df-sso-management.apps.zerozero.tw', 'SSO Management', 'test', 'DF-SSO 管理後台 (Test)')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain IN ('https://df-sso-login.apps.zerozero.tw', 'https://df-sso-management.apps.zerozero.tw')
  `);
};

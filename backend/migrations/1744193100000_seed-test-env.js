exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, env, description)
    VALUES
      ('https://df-sso-login.apps.zerozero.tw', 'SSO Frontend', 'test', 'DF-SSO Login (Test)')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain = 'https://df-sso-login.apps.zerozero.tw'
  `);
};

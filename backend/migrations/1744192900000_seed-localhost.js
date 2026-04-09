exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, env, description)
    VALUES
      ('http://localhost:3000', 'SSO Frontend', 'local', 'DF-SSO 管理後台（本機開發）'),
      ('http://localhost:3100', 'App A', 'local', '資產管理系統（本機開發）'),
      ('http://localhost:3200', 'App B', 'local', '報修系統（本機開發）')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain IN ('http://localhost:3000', 'http://localhost:3100', 'http://localhost:3200')
  `);
};

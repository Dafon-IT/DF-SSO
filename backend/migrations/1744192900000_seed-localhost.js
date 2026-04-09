exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, description)
    VALUES
      ('http://localhost:3000', 'SSO Frontend', 'DF-SSO 管理後台（本機開發）'),
      ('http://localhost:3100', 'App A', '資產管理系統（本機開發）'),
      ('http://localhost:3200', 'App B', '報修系統（本機開發）')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain IN ('http://localhost:3000', 'http://localhost:3100', 'http://localhost:3200')
  `);
};

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, description)
    VALUES ('http://localhost:3000', 'DF-SSO Frontend (本機開發)', '本機開發環境')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain = 'http://localhost:3000'
  `);
};

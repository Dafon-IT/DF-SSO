exports.shorthands = undefined;

exports.up = (pgm) => {
  // 清理錯誤新增的 login domain（若存在）
  pgm.sql(`
    DELETE FROM sso_allowed_list WHERE domain = 'https://df-sso-login.apps.zerozero.tw'
  `);
};

exports.down = () => {
  // 不需要還原，login domain 本來就不應該存在
};

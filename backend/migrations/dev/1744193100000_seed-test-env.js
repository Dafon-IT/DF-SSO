export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO sso_allowed_list (domain, name, env, description)
    VALUES
      ('https://df-sso-management-test.apps.zerozero.tw', 'SSO Management', 'test', 'DF-SSO 管理後台 (Test)')
    ON CONFLICT DO NOTHING
  `);
};

export const down = () => {
  // management domain 為必要資料，不刪除
};

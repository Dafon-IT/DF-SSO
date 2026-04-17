/**
 * 移除 sso_allowed_list 的 env 欄位
 * 原因：每個環境獨立部署一套 SSO，不再需要在 DB 層區分環境
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.dropColumn('sso_allowed_list', 'env');
};

export const down = (pgm) => {
  pgm.addColumn('sso_allowed_list', {
    env: {
      type: 'varchar(20)',
      notNull: true,
      default: 'local',
    },
  });
};

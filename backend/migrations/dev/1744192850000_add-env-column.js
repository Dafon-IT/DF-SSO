export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('sso_allowed_list', {
    env: {
      type: 'varchar(20)',
      notNull: true,
      default: 'local',
      comment: '環境：production / test / local',
    },
  });

  // 更新既有資料
  pgm.sql(`
    UPDATE sso_allowed_list SET env = 'local' WHERE env = 'local';
  `);
};

export const down = (pgm) => {
  pgm.dropColumn('sso_allowed_list', 'env');
};

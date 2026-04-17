import crypto from 'crypto';

export const up = (pgm) => {
  // 新增 OAuth2 Client 欄位
  pgm.addColumns('sso_allowed_list', {
    app_id: { type: 'uuid', default: pgm.func('uuidv7()'), unique: true, notNull: true },
    app_secret: { type: 'varchar(64)', notNull: true, default: '' },
    redirect_uris: { type: 'text[]', notNull: true, default: '{}' },
  });

  // 為現有資料產生 app_secret 並把 domain 放進 redirect_uris
  pgm.sql(`
    UPDATE sso_allowed_list
    SET app_secret = encode(gen_random_bytes(32), 'hex'),
        redirect_uris = ARRAY[domain]
    WHERE app_secret = ''
  `);
};

export const down = (pgm) => {
  pgm.dropColumns('sso_allowed_list', ['app_id', 'app_secret', 'redirect_uris']);
};

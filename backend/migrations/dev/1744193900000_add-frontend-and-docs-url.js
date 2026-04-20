export const up = (pgm) => {
  pgm.addColumns('sso_allowed_list', {
    frontend_url: { type: 'text', notNull: false },
    backend_docs_url: { type: 'text', notNull: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('sso_allowed_list', ['frontend_url', 'backend_docs_url']);
};

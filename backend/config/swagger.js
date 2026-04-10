const config = require('./index');

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'DF-SSO API',
    version: '1.0.0',
    description:
      '企業單一登入系統（Single Sign-On）— 整合 Microsoft Azure AD + ERP 員工資料查詢。\n\n' +
      '## 認證方式\n' +
      '- **Cookie (`token`)**：SSO Frontend 使用，登入後自動設定\n' +
      '- **Bearer Token**：Client App server-to-server 使用，放在 `Authorization: Bearer <token>` header\n' +
      '- **Admin API**：需管理員身份（JWT + Redis Session + 管理員名單驗證）\n\n' +
      '## 速率限制\n' +
      '| 範圍 | 限制 |\n' +
      '|------|------|\n' +
      '| 全域 | 500 req / 15 min |\n' +
      '| Auth 端點 | 30 req / 15 min |\n' +
      '| Session（/me, /logout） | 100 req / 15 min |\n' +
      '| SSO Exchange | 20 req / 1 min |',
  },
  servers: [
    { url: `http://localhost:${config.port}`, description: '本機開發' },
  ],
  tags: [
    { name: 'Auth', description: '登入 / 登出 / Session 驗證' },
    { name: 'SSO', description: 'OAuth2 Authorization Code Flow（Client App 串接用）' },
    { name: 'Admin - 白名單', description: '白名單 CRUD（需管理員權限）' },
    { name: 'Admin - 管理員', description: '管理員 CRUD（需管理員權限）' },
    { name: 'Admin - 登入紀錄', description: '登入紀錄查詢（需管理員權限）' },
    { name: 'Health', description: '健康檢查' },
  ],

  // ===================== Paths =====================
  paths: {
    // ───── Auth ─────
    [`/api/auth/${config.azure.authPathSegment}/login`]: {
      get: {
        tags: ['Auth'],
        summary: '重導向到 Microsoft 登入頁面',
        description: '產生 CSRF state，重導向使用者到 Microsoft OAuth2 授權頁面。',
        responses: {
          302: { description: '重導向到 Microsoft 登入頁面' },
          302.1: { description: '失敗時重導回 Frontend（?error=microsoft_login_failed）' },
        },
      },
    },

    [`/api/auth/${config.azure.authPathSegment}/redirect`]: {
      get: {
        tags: ['Auth'],
        summary: 'Microsoft OAuth 回調',
        description:
          '接收 Microsoft 回傳的 authorization code，交換 token、查詢 ERP、寫入登入紀錄、發放 JWT。\n' +
          '若為 SSO 流程，會帶一次性 auth code 重導回 Client App。',
        parameters: [
          { name: 'code', in: 'query', schema: { type: 'string' }, description: 'Microsoft authorization code' },
          { name: 'state', in: 'query', schema: { type: 'string' }, description: 'CSRF state parameter' },
          { name: 'error', in: 'query', schema: { type: 'string' }, description: 'OAuth error code' },
          { name: 'error_description', in: 'query', schema: { type: 'string' }, description: 'OAuth error 說明' },
        ],
        responses: {
          302: { description: '成功 → 重導回 Dashboard 或 Client App（帶 code）' },
        },
      },
    },

    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: '取得目前登入使用者資訊',
        description: '驗證 JWT + Redis Session，回傳使用者資料（含 ERP 員工資訊）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } } },
          },
          401: {
            description: '未認證 / Session 過期 / Token 無效',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: '登出',
        description:
          '清除 Redis Session + Cookie，並透過 back-channel（HMAC 簽章）通知所有已註冊的 Client App。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: '登出成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { message: { type: 'string', example: 'Logged out' } },
                },
              },
            },
          },
        },
      },
    },

    // ───── SSO ─────
    '/api/auth/sso/authorize': {
      get: {
        tags: ['SSO'],
        summary: 'OAuth2 授權端點',
        description:
          'Client App 將使用者導到此端點。\n' +
          '- 已有中央 session → 產生一次性 auth code，帶 `?code=` 重導回 `redirect_uri`\n' +
          '- 無 session → 走 Microsoft 登入，完成後再重導回 Client App',
        parameters: [
          {
            name: 'client_id', in: 'query', required: true,
            schema: { type: 'string', format: 'uuid' },
            description: '白名單的 app_id',
          },
          {
            name: 'redirect_uri', in: 'query', required: true,
            schema: { type: 'string', format: 'uri' },
            description: 'Client App callback URL（origin 必須在該 App 的 redirect_uris 中）',
          },
        ],
        responses: {
          302: { description: '重導回 redirect_uri（帶 ?code=xxx）或重導到 Microsoft 登入' },
          400: {
            description: '缺少參數或 redirect_uri 格式錯誤',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          403: {
            description: 'client_id 無效或 redirect_uri 未註冊',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    '/api/auth/sso/exchange': {
      post: {
        tags: ['SSO'],
        summary: 'Auth Code 交換（Token Endpoint）',
        description:
          'Client App 後端用一次性 auth code + client credentials 換取用戶資料 + JWT token。\n' +
          '使用 Redis Lua script 保證原子性，auth code 僅能使用一次（60 秒過期）。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ExchangeRequest' },
            },
          },
        },
        responses: {
          200: {
            description: '交換成功',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ExchangeResponse' } },
            },
          },
          400: {
            description: 'code 格式錯誤或缺少參數',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          401: {
            description: 'client credentials 錯誤或 code 過期',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    '/api/auth/sso/logout': {
      get: {
        tags: ['SSO'],
        summary: '全域登出（SSO Logout）',
        description:
          '清除中央 session、token cookie，back-channel 通知所有 Client App，最後重導到 redirect origin。\n' +
          'redirect 必須在已註冊的 redirect_uris 中（僅保留 origin，防止 open redirect）。',
        parameters: [
          {
            name: 'redirect', in: 'query',
            schema: { type: 'string', format: 'uri' },
            description: '登出後重導的 URL（僅 origin 會被使用）',
          },
        ],
        responses: {
          302: { description: '重導到 redirect origin 或 Frontend URL' },
        },
      },
    },

    // ───── Admin - 白名單 ─────
    '/api/allowed-list': {
      get: {
        tags: ['Admin - 白名單'],
        summary: '取得所有白名單',
        description: '回傳所有已註冊的 App（含停用的），`app_secret` 僅顯示末 4 碼。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'array', items: { $ref: '#/components/schemas/AllowedItem' } },
                  },
                },
              },
            },
          },
          401: { description: '未認證', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: '非管理員', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Admin - 白名單'],
        summary: '新增白名單',
        description: '新增 App，自動產生 `app_id` + `app_secret`。回傳完整 secret（**僅此一次**）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AllowedItemCreate' },
            },
          },
        },
        responses: {
          201: {
            description: '建立成功（含完整 app_secret）',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AllowedItemFull' },
                  },
                },
              },
            },
          },
          400: { description: '參數錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
          409: { description: '網域已存在', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
    },

    '/api/allowed-list/{uid}': {
      get: {
        tags: ['Admin - 白名單'],
        summary: '取得單筆白名單',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'App UUID' },
        ],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AllowedItem' },
                  },
                },
              },
            },
          },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
      put: {
        tags: ['Admin - 白名單'],
        summary: '更新白名單',
        description: '支援部分更新（只傳需要改的欄位）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AllowedItemUpdate' },
            },
          },
        },
        responses: {
          200: {
            description: '更新成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AllowedItem' },
                  },
                },
              },
            },
          },
          400: { description: '參數錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
      delete: {
        tags: ['Admin - 白名單'],
        summary: '軟刪除白名單',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: '刪除成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AllowedItem' },
                  },
                },
              },
            },
          },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
    },

    '/api/allowed-list/{uid}/regenerate-secret': {
      post: {
        tags: ['Admin - 白名單'],
        summary: '重新產生 app_secret',
        description: '產生新的 64 字元隨機 secret，舊 secret 立即失效。回傳完整 secret（**僅此一次**）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: '成功（含完整 app_secret）',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AllowedItemFull' },
                  },
                },
              },
            },
          },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
    },

    // ───── Admin - 管理員 ─────
    '/api/admin-manager': {
      get: {
        tags: ['Admin - 管理員'],
        summary: '取得所有管理員',
        description: '回傳所有管理員（含停用的），`is_newer = true` 表示尚未登入過。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'array', items: { $ref: '#/components/schemas/AdminItem' } },
                  },
                },
              },
            },
          },
          401: { description: '未認證', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: '非管理員', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Admin - 管理員'],
        summary: '新增管理員',
        description:
          '僅需提供 email。新管理員 `is_newer = true`，首次登入 SSO 後自動填入 `azure_oid`、`name` 並設為 `false`。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminItemCreate' },
            },
          },
        },
        responses: {
          201: {
            description: '建立成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AdminItem' },
                  },
                },
              },
            },
          },
          400: { description: '參數錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
          409: { description: 'Email 已存在', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
    },

    '/api/admin-manager/{uid}': {
      get: {
        tags: ['Admin - 管理員'],
        summary: '取得單筆管理員',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AdminItem' },
                  },
                },
              },
            },
          },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
      put: {
        tags: ['Admin - 管理員'],
        summary: '更新管理員',
        description: '支援部分更新（email, is_active）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminItemUpdate' },
            },
          },
        },
        responses: {
          200: {
            description: '更新成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AdminItem' },
                  },
                },
              },
            },
          },
          400: { description: '參數錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
      delete: {
        tags: ['Admin - 管理員'],
        summary: '軟刪除管理員',
        description: '無法刪除自己。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: '刪除成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/AdminItem' },
                  },
                },
              },
            },
          },
          400: { description: '無法刪除自己', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
          404: { description: '找不到', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithSuccess' } } } },
        },
      },
    },

    // ───── Admin - 登入紀錄 ─────
    '/api/login-log': {
      get: {
        tags: ['Admin - 登入紀錄'],
        summary: '搜尋登入紀錄',
        description: '支援 email 模糊搜尋、狀態篩選、日期範圍、分頁（pageSize 上限 100）。',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'email', in: 'query', schema: { type: 'string' }, description: 'Email 模糊搜尋（ILIKE %...%）' },
          {
            name: 'status', in: 'query',
            schema: { type: 'string', enum: ['success', 'failed', 'erp_not_found'] },
            description: '登入狀態',
          },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: '起始日期' },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: '結束日期' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 }, description: '頁碼' },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 }, description: '每頁筆數' },
        ],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LoginLogSearchResponse' } },
            },
          },
          401: { description: '未認證', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: '非管理員', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ───── Health ─────
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: '健康檢查',
        description: '檢查 PostgreSQL 和 Redis 連線狀態。',
        responses: {
          200: {
            description: '服務正常',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: { status: 'ok', timestamp: '2026-04-10T08:00:00.000Z', pg: 'connected', redis: 'connected' },
              },
            },
          },
          503: {
            description: '服務降級',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: { status: 'degraded', timestamp: '2026-04-10T08:00:00.000Z', pg: 'disconnected', redis: 'connected' },
              },
            },
          },
        },
      },
    },
  },

  // ===================== Components =====================
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Client App server-to-server 使用',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'token',
        description: 'SSO Frontend 登入後自動設定的 httpOnly cookie',
      },
    },

    schemas: {
      // ── 共用 ──
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Not authenticated' },
        },
      },
      ErrorWithSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'domain is required' },
        },
      },

      // ── ERP ──
      ErpData: {
        type: 'object',
        nullable: true,
        description: 'ERP 員工資料（可能為 null）',
        properties: {
          gen01: { type: 'string', description: '員工編號', example: '00063' },
          gen02: { type: 'string', description: '姓名', example: '王小明' },
          gen03: { type: 'string', description: '部門代碼', example: 'F000' },
          gem02: { type: 'string', description: '部門名稱', example: '財務部' },
          gen06: { type: 'string', description: 'Email', example: 'user@df-recycle.com' },
        },
      },

      // ── Auth ──
      SessionUser: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Azure AD Object ID', example: '00000000-0000-0000-0000-000000000000' },
          email: { type: 'string', format: 'email', example: 'user@df-recycle.com' },
          name: { type: 'string', example: '王小明' },
          erpData: { $ref: '#/components/schemas/ErpData' },
          loginLogUid: { type: 'string', nullable: true, description: '登入紀錄 UID' },
          loginAt: { type: 'string', format: 'date-time', description: '登入時間' },
        },
      },
      MeResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/SessionUser' },
        },
      },

      // ── SSO Exchange ──
      ExchangeRequest: {
        type: 'object',
        required: ['code', 'client_id', 'client_secret'],
        properties: {
          code: { type: 'string', description: '一次性授權碼（64 字元 hex）', minLength: 64, maxLength: 64, example: 'a1b2c3...' },
          client_id: { type: 'string', format: 'uuid', description: '白名單的 app_id' },
          client_secret: { type: 'string', description: '白名單的 app_secret（64 字元 hex）' },
        },
      },
      ExchangeResponse: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              userId: { type: 'string', description: 'Azure AD Object ID' },
              email: { type: 'string', format: 'email' },
              name: { type: 'string' },
              erpData: { $ref: '#/components/schemas/ErpData' },
            },
          },
          token: { type: 'string', description: 'JWT token（用於後續呼叫 /api/auth/me）' },
        },
      },

      // ── 白名單（列表 / 詳情 — secret 已遮蔽）──
      AllowedItem: {
        type: 'object',
        properties: {
          ppid: { type: 'integer', example: 1 },
          uid: { type: 'string', format: 'uuid' },
          domain: { type: 'string', format: 'uri', example: 'https://crm.df-recycle.com.tw' },
          name: { type: 'string', nullable: true, example: 'CRM 系統' },
          description: { type: 'string', nullable: true, example: '客戶關係管理' },
          app_id: { type: 'string', format: 'uuid', description: 'OAuth2 Client ID' },
          app_secret_last4: { type: 'string', description: '僅末 4 碼', example: '****a1b2' },
          redirect_uris: {
            type: 'array', items: { type: 'string', format: 'uri' },
            example: ['https://crm.df-recycle.com.tw', 'http://localhost:3100'],
          },
          is_active: { type: 'boolean', example: true },
          is_deleted: { type: 'boolean', example: false },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      // ── 白名單（建立 / regenerate — 含完整 secret）──
      AllowedItemFull: {
        type: 'object',
        description: '含完整 app_secret（僅在建立 / regenerate 時回傳一次）',
        properties: {
          ppid: { type: 'integer' },
          uid: { type: 'string', format: 'uuid' },
          domain: { type: 'string', format: 'uri' },
          name: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          app_id: { type: 'string', format: 'uuid' },
          app_secret: { type: 'string', description: '完整 64 字元 hex（僅此一次可見）' },
          redirect_uris: { type: 'array', items: { type: 'string', format: 'uri' } },
          is_active: { type: 'boolean' },
          is_deleted: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      // ── 白名單 Request Body ──
      AllowedItemCreate: {
        type: 'object',
        required: ['domain'],
        properties: {
          domain: { type: 'string', format: 'uri', description: '主要網域（含 https://）', example: 'https://crm.df-recycle.com.tw' },
          name: { type: 'string', description: '系統名稱', example: 'CRM 系統' },
          description: { type: 'string', description: '說明', example: '客戶關係管理系統' },
          redirect_uris: {
            type: 'array', items: { type: 'string', format: 'uri' },
            description: '允許的 redirect origin（最多 10 筆，預設為 [domain]）',
            maxItems: 10,
            example: ['https://crm.df-recycle.com.tw', 'http://localhost:3100'],
          },
        },
      },
      AllowedItemUpdate: {
        type: 'object',
        description: '支援部分更新，只需傳要修改的欄位',
        properties: {
          domain: { type: 'string', format: 'uri' },
          name: { type: 'string' },
          description: { type: 'string' },
          is_active: { type: 'boolean' },
          redirect_uris: {
            type: 'array', items: { type: 'string', format: 'uri' },
            maxItems: 10,
          },
        },
      },

      // ── 管理員 ──
      AdminItem: {
        type: 'object',
        properties: {
          ppid: { type: 'integer', example: 1 },
          uid: { type: 'string', format: 'uuid' },
          azure_oid: { type: 'string', nullable: true, description: '首次登入後自動填入' },
          email: { type: 'string', format: 'email', example: 'admin@df-recycle.com' },
          name: { type: 'string', nullable: true, description: '首次登入後自動填入' },
          is_active: { type: 'boolean', example: true },
          is_newer: { type: 'boolean', description: 'true = 尚未登入過，缺少 azure_oid / name', example: false },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      AdminItemCreate: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', description: '管理員 Email（必須是 Azure AD 帳號）', example: 'new-admin@df-recycle.com' },
        },
      },
      AdminItemUpdate: {
        type: 'object',
        description: '支援部分更新',
        properties: {
          email: { type: 'string', format: 'email' },
          is_active: { type: 'boolean' },
        },
      },

      // ── 登入紀錄 ──
      LoginLog: {
        type: 'object',
        properties: {
          ppid: { type: 'integer' },
          uid: { type: 'string', format: 'uuid' },
          azure_oid: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          name: { type: 'string', nullable: true },
          preferred_username: { type: 'string', nullable: true },
          erp_gen01: { type: 'string', nullable: true, description: '員工編號' },
          erp_gen02: { type: 'string', nullable: true, description: '姓名' },
          erp_gen03: { type: 'string', nullable: true, description: '部門代碼' },
          erp_gem02: { type: 'string', nullable: true, description: '部門名稱' },
          erp_gen06: { type: 'string', nullable: true, description: 'Email' },
          status: { type: 'string', enum: ['success', 'failed', 'erp_not_found'] },
          error_message: { type: 'string', nullable: true },
          ip_address: { type: 'string', nullable: true },
          user_agent: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      LoginLogSearchResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/LoginLog' } },
          total: { type: 'integer', description: '總筆數', example: 128 },
          page: { type: 'integer', description: '目前頁碼', example: 1 },
          pageSize: { type: 'integer', description: '每頁筆數', example: 20 },
          totalPages: { type: 'integer', description: '總頁數', example: 7 },
        },
      },

      // ── Health ──
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          timestamp: { type: 'string', format: 'date-time' },
          pg: { type: 'string', enum: ['connected', 'disconnected'] },
          redis: { type: 'string', enum: ['connected', 'disconnected'] },
        },
      },
    },
  },
};

module.exports = swaggerSpec;

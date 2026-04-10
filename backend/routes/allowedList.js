const express = require('express');
const allowedListService = require('../services/allowedList');

const router = express.Router();

/**
 * GET /api/allowed-list
 * 取得所有白名單（含 inactive）
 */
router.get('/', async (req, res) => {
  try {
    const list = await allowedListService.findAll({ includeInactive: true });
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('AllowedList findAll error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/allowed-list/:uid
 * 取得單筆白名單
 */
router.get('/:uid', async (req, res) => {
  try {
    const item = await allowedListService.findByUid(req.params.uid);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList findByUid error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/allowed-list
 * 新增白名單（自動產生 app_id + app_secret）
 */
router.post('/', async (req, res) => {
  try {
    const { domain, name, description, redirect_uris } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'domain is required' });
    }

    // 驗證 domain 是否為合法 URL
    try {
      const url = new URL(domain);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return res.status(400).json({ success: false, error: 'domain must use http or https protocol' });
      }
    } catch {
      return res.status(400).json({ success: false, error: 'domain must be a valid URL' });
    }

    // 驗證 redirect_uris（若有提供）
    if (redirect_uris && Array.isArray(redirect_uris)) {
      if (redirect_uris.length > 10) {
        return res.status(400).json({ success: false, error: 'redirect_uris 最多 10 筆' });
      }
      for (const uri of redirect_uris) {
        try {
          const u = new URL(uri);
          if (!['http:', 'https:'].includes(u.protocol)) {
            return res.status(400).json({ success: false, error: `Invalid redirect_uri: ${uri}` });
          }
        } catch {
          return res.status(400).json({ success: false, error: `Invalid redirect_uri: ${uri}` });
        }
      }
    }

    const item = await allowedListService.create({
      domain,
      name,
      description,
      redirectUris: redirect_uris,
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList create error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: '此網域已存在' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/allowed-list/:uid
 * 更新白名單
 */
router.put('/:uid', async (req, res) => {
  try {
    const { domain, name, description, is_active, redirect_uris } = req.body;

    // 若有提供 domain，驗證是否為合法 URL
    if (domain !== undefined) {
      try {
        const url = new URL(domain);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return res.status(400).json({ success: false, error: 'domain must use http or https protocol' });
        }
      } catch {
        return res.status(400).json({ success: false, error: 'domain must be a valid URL' });
      }
    }

    // 驗證 redirect_uris（若有提供）
    if (redirect_uris !== undefined && Array.isArray(redirect_uris)) {
      if (redirect_uris.length > 10) {
        return res.status(400).json({ success: false, error: 'redirect_uris 最多 10 筆' });
      }
      for (const uri of redirect_uris) {
        try {
          const u = new URL(uri);
          if (!['http:', 'https:'].includes(u.protocol)) {
            return res.status(400).json({ success: false, error: `Invalid redirect_uri: ${uri}` });
          }
        } catch {
          return res.status(400).json({ success: false, error: `Invalid redirect_uri: ${uri}` });
        }
      }
    }

    const item = await allowedListService.update(req.params.uid, {
      domain,
      name,
      description,
      isActive: is_active,
      redirectUris: redirect_uris,
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList update error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/allowed-list/:uid/regenerate-secret
 * 重新產生 app_secret
 */
router.post('/:uid/regenerate-secret', async (req, res) => {
  try {
    const item = await allowedListService.regenerateSecret(req.params.uid);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList regenerateSecret error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/allowed-list/:uid
 * 軟刪除白名單
 */
router.delete('/:uid', async (req, res) => {
  try {
    const item = await allowedListService.remove(req.params.uid);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList remove error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

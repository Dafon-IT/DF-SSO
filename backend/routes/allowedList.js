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
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/allowed-list
 * 新增白名單（若已軟刪除則恢復）
 */
router.post('/', async (req, res) => {
  try {
    const { domain, name, env, description } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'domain is required' });
    }
    if (env && !['production', 'test', 'local'].includes(env)) {
      return res.status(400).json({ success: false, error: 'env must be production, test, or local' });
    }
    const item = await allowedListService.create({ domain, name, env, description });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList create error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: '此網域已存在' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/allowed-list/:uid
 * 更新白名單
 */
router.put('/:uid', async (req, res) => {
  try {
    const { domain, name, env, description, is_active } = req.body;
    if (env && !['production', 'test', 'local'].includes(env)) {
      return res.status(400).json({ success: false, error: 'env must be production, test, or local' });
    }
    const item = await allowedListService.update(req.params.uid, {
      domain,
      name,
      env,
      description,
      isActive: is_active,
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AllowedList update error:', error.message);
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

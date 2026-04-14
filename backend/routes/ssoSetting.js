const express = require('express');
const ssoSettingService = require('../services/ssoSetting');
const rateLimitManager = require('../services/rateLimitManager');

const router = express.Router();

/**
 * GET /api/sso-setting
 * 列出全部設定（依 category + key 排序）
 */
router.get('/', async (req, res) => {
  try {
    const list = await ssoSettingService.findAll();
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('SsoSetting findAll error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/sso-setting/:key
 */
router.get('/:key', async (req, res) => {
  try {
    const item = await ssoSettingService.findByKey(req.params.key);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('SsoSetting findByKey error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 依 key 的 category prefix 決定 value 該長怎樣
 */
function validateValue(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'value must be a JSON object';
  }

  if (key.startsWith('rate_limit.')) {
    const { windowMs, max } = value;
    if (!Number.isFinite(windowMs) || !Number.isFinite(max)) {
      return 'rate_limit value must contain numeric windowMs and max';
    }
    if (windowMs < 1000) {
      return 'windowMs must be >= 1000 (ms)';
    }
    if (max < 1) {
      return 'max must be >= 1';
    }
  }

  return null;
}

/**
 * PUT /api/sso-setting/:key
 * Body: { value: { ... } }
 * 成功後若為 rate_limit.* 類型會觸發 rateLimitManager.reload() 讓新設定立即生效
 */
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body || {};

    if (value === undefined) {
      return res.status(400).json({ success: false, error: 'value is required' });
    }

    const validationError = validateValue(key, value);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const existing = await ssoSettingService.findByKey(key);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const updated = await ssoSettingService.updateValueByKey(key, value);

    // Rate limit 設定變更 → 立即重建 limiter instance
    if (key.startsWith('rate_limit.')) {
      await rateLimitManager.reload();
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('SsoSetting update error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

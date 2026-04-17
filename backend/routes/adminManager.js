import express from 'express';
import adminManagerService from '../services/adminManager.js';

const router = express.Router();

/**
 * GET /api/admin-manager
 * 取得所有管理員
 */
router.get('/', async (req, res) => {
  try {
    const list = await adminManagerService.findAll();
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('AdminManager findAll error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/admin-manager/:uid
 * 取得單筆管理員
 */
router.get('/:uid', async (req, res) => {
  try {
    const item = await adminManagerService.findByUid(req.params.uid);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AdminManager findByUid error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/admin-manager
 * 新增管理員（僅需 email）
 */
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'email is required' });
    }

    // 基本 email 格式驗證
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const item = await adminManagerService.create({ email: email.toLowerCase().trim() });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('AdminManager create error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: '此 Email 已存在' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/admin-manager/:uid
 * 更新管理員（email, is_active）
 */
router.put('/:uid', async (req, res) => {
  try {
    const { email, is_active } = req.body;

    if (email !== undefined) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }
    }

    const item = await adminManagerService.update(req.params.uid, {
      email: email ? email.toLowerCase().trim() : undefined,
      isActive: is_active,
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AdminManager update error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: '此 Email 已存在' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin-manager/:uid
 * 軟刪除管理員
 */
router.delete('/:uid', async (req, res) => {
  try {
    // 防止刪除自己
    if (req.user && req.user.email) {
      const target = await adminManagerService.findByUid(req.params.uid);
      if (target && target.email === req.user.email) {
        return res.status(400).json({ success: false, error: '無法刪除自己' });
      }
    }

    const item = await adminManagerService.remove(req.params.uid);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('AdminManager remove error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

import express from 'express';
import loginLogService from '../services/loginLog.js';

const router = express.Router();

/**
 * GET /api/login-log
 * 搜尋登入紀錄
 * Query params: email, status, startDate, endDate, page, pageSize
 */
router.get('/', async (req, res) => {
  try {
    const { email, status, startDate, endDate, page, pageSize } = req.query;
    const result = await loginLogService.search({
      email: email || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('LoginLog search error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

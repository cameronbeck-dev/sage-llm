import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getUsageReport } from '../services/usage.js';

export const usageRouter = Router();

// GET /usage — usage report for the current or specified period
usageRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const report = await getUsageReport(req.session!.userId!, from, to);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// GET /usage/export.csv — download daily spend as CSV
usageRouter.get('/export.csv', requireAuth, async (req, res, next) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const report = await getUsageReport(req.session!.userId!, from, to);
    const lines = ['date,costUsd', ...report.byDay.map((d) => `${d.date},${d.costUsd.toFixed(4)}`)];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sage-usage.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

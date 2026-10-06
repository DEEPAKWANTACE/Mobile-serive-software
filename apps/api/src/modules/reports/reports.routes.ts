import { Router } from 'express';
import { dashboardSummaryQuerySchema, engineerReportQuerySchema, REPORT_ROLES, reportQuerySchema, ROLES, type EngineerReportQuery, type ReportQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './reports.service.ts';

export const reportRoutes = Router();

reportRoutes.get('/', authorize(...REPORT_ROLES), validate({ query: reportQuerySchema }), async (req, res) => {
  res.json(await service.build(res.locals.query as ReportQuery, actorOf(req)));
});

reportRoutes.get('/engineer-jobs', authorize(...REPORT_ROLES), validate({ query: engineerReportQuerySchema }), async (req, res) => {
  res.json(await service.engineerReport(res.locals.query as EngineerReportQuery, actorOf(req)));
});
// Dashboard money/volume summary — counter staff see their branch; Super Admin any branch.
reportRoutes.get(
  '/dashboard-summary',
  authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ACCOUNTS),
  validate({ query: dashboardSummaryQuerySchema }),
  async (req, res) => {
    res.json(await service.dashboardSummary(res.locals.query as { from?: string; to?: string; branchId?: string }, actorOf(req)));
  },
);

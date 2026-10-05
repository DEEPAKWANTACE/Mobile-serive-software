import { Router } from 'express';
import { REPORT_ROLES, reportQuerySchema, type ReportQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './reports.service.ts';

export const reportRoutes = Router();

reportRoutes.get('/', authorize(...REPORT_ROLES), validate({ query: reportQuerySchema }), async (req, res) => {
  res.json(await service.build(res.locals.query as ReportQuery, actorOf(req)));
});

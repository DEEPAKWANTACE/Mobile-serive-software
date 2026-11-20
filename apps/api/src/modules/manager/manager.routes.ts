import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema, MANAGER_ROLES, managerRangeQuerySchema, managerRemarkSchema, pendingJobsQuerySchema, poCreateSchema, poListQuerySchema, type ManagerRangeQuery, type PendingJobsQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './manager.service.ts';
import * as ops from './manager.ops.service.ts';

export const managerRoutes = Router();
managerRoutes.use(authorize(...MANAGER_ROLES));

managerRoutes.get('/pending-jobs', validate({ query: pendingJobsQuerySchema }), async (req, res) => {
  res.json(await service.pendingJobs(res.locals.query as PendingJobsQuery, actorOf(req)));
});
managerRoutes.get('/diagnosis-pending', validate({ query: managerRangeQuerySchema }), async (req, res) => {
  res.json(await service.diagnosisPending(res.locals.query as ManagerRangeQuery, actorOf(req)));
});
managerRoutes.get('/purchase-order', validate({ query: managerRangeQuerySchema }), async (req, res) => {
  res.json(await service.purchaseOrder(res.locals.query as ManagerRangeQuery, actorOf(req)));
});
managerRoutes.get('/profit-loss', validate({ query: managerRangeQuerySchema }), async (req, res) => {
  res.json(await service.profitLoss(res.locals.query as ManagerRangeQuery, actorOf(req)));
});

const branchQuery = z.object({ branchId: z.uuid().optional() });
managerRoutes.get('/alerts', validate({ query: branchQuery }), async (req, res) => {
  res.json(await ops.alerts(actorOf(req), (res.locals.query as { branchId?: string }).branchId));
});
managerRoutes.get('/overview', validate({ query: managerRangeQuerySchema }), async (req, res) => {
  res.json(await ops.overview(res.locals.query as ManagerRangeQuery, actorOf(req)));
});
managerRoutes.get('/stock-overview', validate({ query: branchQuery }), async (req, res) => {
  res.json(await ops.stockOverview(actorOf(req), (res.locals.query as { branchId?: string }).branchId));
});
managerRoutes.get('/calling-report', validate({ query: managerRangeQuerySchema }), async (req, res) => {
  res.json(await ops.callingReport(res.locals.query as ManagerRangeQuery, actorOf(req)));
});
managerRoutes.get('/purchase-orders', validate({ query: poListQuerySchema }), async (req, res) => {
  res.json(await ops.listPos(actorOf(req), (res.locals.query as { branchId?: string }).branchId));
});
managerRoutes.post('/purchase-orders', validate({ body: poCreateSchema }), async (req, res) => {
  res.status(201).json(await ops.createPo(req.body, actorOf(req)));
});
managerRoutes.post('/purchase-orders/:id/forward', validate({ params: idParamSchema }), async (req, res) => {
  await ops.forwardPo(req.params.id as string, actorOf(req));
  res.status(204).end();
});
managerRoutes.post('/remarks', validate({ body: managerRemarkSchema }), async (req, res) => {
  await ops.addDiagnosisRemark(req.body.jobId, req.body.remark, actorOf(req));
  res.status(204).end();
});

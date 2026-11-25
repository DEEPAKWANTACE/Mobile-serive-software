import { Router } from 'express';
import {
  idParamSchema,
  manualPoSchema,
  poDecisionSchema,
  poListQuerySchema,
  ROLES,
  supplyCreateSchema,
  supplyListQuerySchema,
  type SupplyListQuery,
} from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './purchase.service.ts';

const branchSide = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.STOREKEEPER);
const supplier = authorize(ROLES.SUPER_ADMIN, ROLES.CENTRAL_STOREKEEPER);
const everyone = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.STOREKEEPER, ROLES.CENTRAL_STOREKEEPER);

export const purchaseOrderRoutes = Router();
purchaseOrderRoutes.get('/', everyone, validate({ query: poListQuerySchema }), async (req, res) => {
  res.json(await service.list(actorOf(req), (res.locals.query as { branchId?: string }).branchId));
});
purchaseOrderRoutes.post('/', branchSide, validate({ body: manualPoSchema }), async (req, res) => {
  res.status(201).json(await service.createManual(req.body, actorOf(req)));
});
purchaseOrderRoutes.post('/:id/send', branchSide, validate({ params: idParamSchema }), async (req, res) => {
  await service.send(req.params.id as string, actorOf(req));
  res.status(204).end();
});
purchaseOrderRoutes.post('/:id/accept', supplier, validate({ params: idParamSchema }), async (req, res) => {
  await service.accept(req.params.id as string, actorOf(req));
  res.status(204).end();
});
purchaseOrderRoutes.post('/:id/reject', supplier, validate({ params: idParamSchema, body: poDecisionSchema }), async (req, res) => {
  await service.reject(req.params.id as string, req.body.reason, actorOf(req));
  res.status(204).end();
});
purchaseOrderRoutes.post('/:id/close', supplier, validate({ params: idParamSchema, body: poDecisionSchema }), async (req, res) => {
  await service.closeShort(req.params.id as string, req.body.reason, actorOf(req));
  res.status(204).end();
});

export const centralRoutes = Router();
centralRoutes.get('/overview', supplier, async (req, res) => {
  res.json(await service.overview(actorOf(req)));
});
centralRoutes.get('/supplies', everyone, validate({ query: supplyListQuerySchema }), async (req, res) => {
  res.json(await service.supplies(res.locals.query as SupplyListQuery, actorOf(req)));
});
centralRoutes.post('/supplies', supplier, validate({ body: supplyCreateSchema }), async (req, res) => {
  res.status(201).json(await service.supply(req.body, actorOf(req)));
});

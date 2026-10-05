import { Router } from 'express';
import {
  idParamSchema,
  movementListQuerySchema,
  partRequestActionSchema,
  partRequestListQuerySchema,
  ROLES,
  STORE_ROLES,
  stockAdjustmentSchema,
  stockListQuerySchema,
  stockReceiptSchema,
  stockTransferCreateSchema,
  stockTransferListQuerySchema,
  type StockTransferListQuery,
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './inventory.controller.ts';
import * as transfers from './transfers.service.ts';
import { actorOf } from '../../lib/request-context.ts';

export const inventoryRoutes = Router();

const store = authorize(...STORE_ROLES);

inventoryRoutes.get('/stock', store, validate({ query: stockListQuerySchema }), controller.stock);
inventoryRoutes.post('/receipts', store, validate({ body: stockReceiptSchema }), controller.receive);
inventoryRoutes.post('/adjustments', store, validate({ body: stockAdjustmentSchema }), controller.adjust);
inventoryRoutes.get('/movements', store, validate({ query: movementListQuerySchema }), controller.movements);

// Part requests from engineers
inventoryRoutes.get('/part-requests', store, validate({ query: partRequestListQuerySchema }), controller.requests);
inventoryRoutes.post('/part-requests/:id/issue', store, validate({ params: idParamSchema, body: partRequestActionSchema }), controller.issue);
inventoryRoutes.post(
  '/part-requests/:id/not-available',
  store,
  validate({ params: idParamSchema, body: partRequestActionSchema }),
  controller.notAvailable,
);
inventoryRoutes.post(
  '/part-requests/:id/return',
  store,
  validate({ params: idParamSchema, body: partRequestActionSchema }),
  controller.returnToStock,
);
inventoryRoutes.post(
  '/part-requests/:id/cancel',
  authorize(...STORE_ROLES, ROLES.ENGINEER),
  validate({ params: idParamSchema }),
  controller.cancel,
);

// Stock transfers between branches
inventoryRoutes.get('/transfers', store, validate({ query: stockTransferListQuerySchema }), async (req, res) => {
  res.json(await transfers.list(res.locals.query as StockTransferListQuery, actorOf(req)));
});
inventoryRoutes.post('/transfers', store, validate({ body: stockTransferCreateSchema }), async (req, res) => {
  res.status(201).json(await transfers.send(req.body, actorOf(req)));
});
inventoryRoutes.post('/transfers/:id/receive', store, validate({ params: idParamSchema }), async (req, res) => {
  res.json(await transfers.receive(req.params.id as string, actorOf(req)));
});
inventoryRoutes.post('/transfers/:id/cancel', store, validate({ params: idParamSchema }), async (req, res) => {
  res.json(await transfers.cancel(req.params.id as string, actorOf(req)));
});

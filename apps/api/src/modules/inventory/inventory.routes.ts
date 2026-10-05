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
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './inventory.controller.ts';

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

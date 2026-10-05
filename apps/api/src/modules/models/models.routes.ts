import { Router } from 'express';
import {
  idParamSchema,
  modelCreateSchema,
  modelListQuerySchema,
  modelPricesUpdateSchema,
  modelUpdateSchema,
  ROLES,
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './models.controller.ts';

export const modelRoutes = Router();

modelRoutes.get('/', validate({ query: modelListQuerySchema }), controller.list);
modelRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: modelCreateSchema }), controller.create);
modelRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: modelUpdateSchema }),
  controller.update,
);

// Price list for one model (readable by all signed-in users for estimates).
modelRoutes.get('/:id/prices', validate({ params: idParamSchema }), controller.getPrices);
modelRoutes.put(
  '/:id/prices',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: modelPricesUpdateSchema }),
  controller.setPrices,
);

import { Router } from 'express';
import { faultCategoryCreateSchema, faultCategoryUpdateSchema, idParamSchema, listQuerySchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './fault-categories.controller.ts';

export const faultCategoryRoutes = Router();

faultCategoryRoutes.get('/', validate({ query: listQuerySchema }), controller.list);
faultCategoryRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: faultCategoryCreateSchema }), controller.create);
faultCategoryRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: faultCategoryUpdateSchema }),
  controller.update,
);

import { Router } from 'express';
import { catalogListQuerySchema, faultCategoryCreateSchema, faultCategoryUpdateSchema, idParamSchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './fault-categories.controller.ts';

export const faultCategoryRoutes = Router();

faultCategoryRoutes.get('/', validate({ query: catalogListQuerySchema }), controller.list);
faultCategoryRoutes.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: faultCategoryCreateSchema }), controller.create);
faultCategoryRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER),
  validate({ params: idParamSchema, body: faultCategoryUpdateSchema }),
  controller.update,
);

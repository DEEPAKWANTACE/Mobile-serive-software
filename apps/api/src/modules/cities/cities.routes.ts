import { Router } from 'express';
import { cityCreateSchema, cityListQuerySchema, cityUpdateSchema, idParamSchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './cities.controller.ts';

export const cityRoutes = Router();

cityRoutes.get('/', validate({ query: cityListQuerySchema }), controller.list);
cityRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: cityCreateSchema }), controller.create);
cityRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: cityUpdateSchema }),
  controller.update,
);

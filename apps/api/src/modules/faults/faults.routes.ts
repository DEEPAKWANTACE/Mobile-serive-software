import { Router } from 'express';
import { faultCreateSchema, faultListQuerySchema, faultUpdateSchema, idParamSchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './faults.controller.ts';

export const faultRoutes = Router();

faultRoutes.get('/', validate({ query: faultListQuerySchema }), controller.list);
faultRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: faultCreateSchema }), controller.create);
faultRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: faultUpdateSchema }),
  controller.update,
);

import { Router } from 'express';
import { brandCreateSchema, brandUpdateSchema, idParamSchema, listQuerySchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './brands.controller.ts';

export const brandRoutes = Router();

// Readable by all signed-in users (job sheet dropdowns); only Super Admin can change.
brandRoutes.get('/', validate({ query: listQuerySchema }), controller.list);
brandRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: brandCreateSchema }), controller.create);
brandRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: brandUpdateSchema }),
  controller.update,
);

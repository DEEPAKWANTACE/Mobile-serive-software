import { Router } from 'express';
import { idParamSchema, listQuerySchema, ROLES, stateCreateSchema, stateUpdateSchema } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './states.controller.ts';

export const stateRoutes = Router();

// Any signed-in user can read (needed for dropdowns); only Super Admin can change.
stateRoutes.get('/', validate({ query: listQuerySchema }), controller.list);
stateRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: stateCreateSchema }), controller.create);
stateRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: stateUpdateSchema }),
  controller.update,
);

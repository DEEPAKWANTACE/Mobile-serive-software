import { Router } from 'express';
import { branchCreateSchema, branchListQuerySchema, branchUpdateSchema, idParamSchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './branches.controller.ts';

export const branchRoutes = Router();

// Readable by all signed-in users (dropdowns, future transfers); only Super Admin can change.
branchRoutes.get('/', validate({ query: branchListQuerySchema }), controller.list);
branchRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: branchCreateSchema }), controller.create);
branchRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: branchUpdateSchema }),
  controller.update,
);

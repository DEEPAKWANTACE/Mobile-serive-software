import { Router } from 'express';
import {
  idParamSchema,
  resetPasswordSchema,
  ROLES,
  userCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './users.controller.ts';

export const userRoutes = Router();

// Super Admin manages everyone; Branch Manager manages branch staff (enforced in the service).
userRoutes.use(authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER));

userRoutes.get('/', validate({ query: userListQuerySchema }), controller.list);
userRoutes.post('/', validate({ body: userCreateSchema }), controller.create);
userRoutes.patch('/:id', validate({ params: idParamSchema, body: userUpdateSchema }), controller.update);
userRoutes.post(
  '/:id/reset-password',
  validate({ params: idParamSchema, body: resetPasswordSchema }),
  controller.resetPassword,
);

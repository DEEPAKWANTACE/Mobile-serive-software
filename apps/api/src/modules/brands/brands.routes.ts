import { Router } from 'express';
import { z } from 'zod';
import { brandCreateSchema, brandUpdateSchema, catalogListQuerySchema, idParamSchema, ROLES } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './brands.service.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './brands.controller.ts';

export const brandRoutes = Router();

// Readable by all signed-in users (job sheet dropdowns); only Super Admin can change.
brandRoutes.get('/', validate({ query: catalogListQuerySchema }), controller.list);
brandRoutes.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: brandCreateSchema }), controller.create);
// Super Admin: move a branch's brand list (with models) into the global defaults used by every branch.
brandRoutes.post('/make-global', authorize(ROLES.SUPER_ADMIN), validate({ body: z.object({ branchId: z.uuid() }) }), async (req, res) => {
  res.json(await service.makeGlobal({ branchId: req.body.branchId }, actorOf(req)));
});
brandRoutes.post('/:id/make-global', authorize(ROLES.SUPER_ADMIN), validate({ params: idParamSchema }), async (req, res) => {
  res.json(await service.makeGlobal({ brandId: req.params.id as string }, actorOf(req)));
});
brandRoutes.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER),
  validate({ params: idParamSchema, body: brandUpdateSchema }),
  controller.update,
);

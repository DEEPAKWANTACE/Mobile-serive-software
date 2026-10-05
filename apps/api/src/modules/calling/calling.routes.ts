import { Router } from 'express';
import { z } from 'zod';
import { callingListQuerySchema, ROLES, type CallingListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './calling.service.ts';

export const callingRoutes = Router();
callingRoutes.use(authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ACCOUNTS));

callingRoutes.get('/list', validate({ query: callingListQuerySchema }), async (req, res) => {
  res.json(await service.list(res.locals.query as CallingListQuery, actorOf(req)));
});
callingRoutes.get('/summary', validate({ query: z.object({ branchId: z.uuid().optional() }) }), async (req, res) => {
  res.json(await service.summary(actorOf(req), (res.locals.query as { branchId?: string }).branchId));
});

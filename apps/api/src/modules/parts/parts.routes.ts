import { Router } from 'express';
import { idParamSchema, partCreateSchema, partListQuerySchema, partLookupQuerySchema, partUpdateSchema, ROLES } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './parts.controller.ts';

export const partRoutes = Router();

// Everyone signed in can read the parts master (engineers enter codes); only Super Admin changes it.
partRoutes.get('/', validate({ query: partListQuerySchema }), controller.list);
partRoutes.get('/lookup', validate({ query: partLookupQuerySchema }), controller.lookup);
partRoutes.post('/', authorize(ROLES.SUPER_ADMIN), validate({ body: partCreateSchema }), controller.create);
partRoutes.patch('/:id', authorize(ROLES.SUPER_ADMIN), validate({ params: idParamSchema, body: partUpdateSchema }), controller.update);

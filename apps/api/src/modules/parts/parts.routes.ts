import { Router } from 'express';
import { categoryCreateSchema, categoryDeleteSchema, categoryQuerySchema, categoryRenameSchema, type CategoryQuery, idParamSchema, partCreateSchema, partListQuerySchema, partLookupQuerySchema, partStockQuerySchema, partUpdateSchema, ROLES } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { partsInStock } from '../jobs/costing.service.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './parts.controller.ts';
import * as categories from './categories.service.ts';

export const partRoutes = Router();

// Everyone signed in can read the parts master (engineers enter codes); only Super Admin changes it.
partRoutes.get('/', validate({ query: partListQuerySchema }), controller.list);
const catWriters = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.STOREKEEPER);
partRoutes.get('/categories', validate({ query: categoryQuerySchema }), async (req, res) => {
  res.json(await categories.list(res.locals.query as CategoryQuery, actorOf(req)));
});
partRoutes.post('/categories', catWriters, validate({ body: categoryCreateSchema }), async (req, res) => {
  await categories.create(req.body, actorOf(req));
  res.status(201).end();
});
partRoutes.post('/categories/rename', catWriters, validate({ body: categoryRenameSchema }), async (req, res) => {
  await categories.rename(req.body, actorOf(req));
  res.status(204).end();
});
partRoutes.post('/categories/delete', catWriters, validate({ body: categoryDeleteSchema }), async (req, res) => {
  await categories.remove(req.body, actorOf(req));
  res.status(204).end();
});
partRoutes.get('/lookup', validate({ query: partLookupQuerySchema }), controller.lookup);
partRoutes.get('/in-stock', validate({ query: partStockQuerySchema }), async (req, res) => {
  res.json(await partsInStock(res.locals.query as { search?: string; branchId?: string }, actorOf(req)));
});
partRoutes.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: partCreateSchema }), controller.create);
partRoutes.patch('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ params: idParamSchema, body: partUpdateSchema }), controller.update);

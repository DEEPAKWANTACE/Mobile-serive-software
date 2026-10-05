import { Router } from 'express';
import { ACCOUNTS_ROLES, dayBookQuerySchema, expenseCreateSchema, expenseVoidSchema, idParamSchema, type DayBookQuery } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './accounts.service.ts';

export const accountsRoutes = Router();
accountsRoutes.use(authorize(...ACCOUNTS_ROLES));

accountsRoutes.get('/day-book', validate({ query: dayBookQuerySchema }), async (req, res) => {
  res.json(await service.dayBook(res.locals.query as DayBookQuery, actorOf(req)));
});
accountsRoutes.post('/expenses', validate({ body: expenseCreateSchema }), async (req, res) => {
  res.status(201).json(await service.createExpense(req.body, actorOf(req)));
});
accountsRoutes.post('/expenses/:id/void', validate({ params: idParamSchema, body: expenseVoidSchema }), async (req, res) => {
  await service.voidExpense(req.params.id as string, req.body.reason, actorOf(req));
  res.status(204).end();
});

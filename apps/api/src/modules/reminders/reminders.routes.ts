import { Router } from 'express';
import { idParamSchema, reminderCreateSchema, reminderUpdateSchema } from '@msm/shared';
import { validate } from '../../middleware/validate.ts';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './reminders.service.ts';

export const reminderRoutes = Router();

reminderRoutes.get('/', async (req, res) => res.json(await service.feed(actorOf(req))));
reminderRoutes.get('/mine', async (req, res) => res.json(await service.mine(actorOf(req))));
reminderRoutes.get('/assignees', async (req, res) => res.json(await service.assignees(actorOf(req))));
reminderRoutes.post('/', validate({ body: reminderCreateSchema }), async (req, res) => res.status(201).json(await service.create(req.body, actorOf(req))));
reminderRoutes.patch('/:id', validate({ params: idParamSchema, body: reminderUpdateSchema }), async (req, res) => {
  await service.update(req.params.id as string, req.body, actorOf(req));
  res.status(204).end();
});
reminderRoutes.post('/:id/complete', validate({ params: idParamSchema }), async (req, res) => {
  await service.complete(req.params.id as string, actorOf(req));
  res.status(204).end();
});

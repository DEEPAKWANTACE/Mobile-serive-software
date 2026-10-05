import type { Request, Response } from 'express';
import type { ListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './faults.service.ts';

export async function list(_req: Request, res: Response<unknown, { query: ListQuery }>) {
  res.json(await service.list(res.locals.query));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await service.update(req.params.id, req.body, actorOf(req)));
}

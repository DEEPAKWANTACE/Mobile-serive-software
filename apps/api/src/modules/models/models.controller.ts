import type { Request, Response } from 'express';
import type { ModelListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './models.service.ts';

export async function list(_req: Request, res: Response<unknown, { query: ModelListQuery }>) {
  res.json(await service.list(res.locals.query));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await service.update(req.params.id, req.body, actorOf(req)));
}

export async function getPrices(req: Request<{ id: string }>, res: Response) {
  res.json(await service.getPrices(req.params.id));
}

export async function setPrices(req: Request<{ id: string }>, res: Response) {
  res.json(await service.setPrices(req.params.id, req.body, actorOf(req)));
}

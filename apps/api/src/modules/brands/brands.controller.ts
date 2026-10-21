import type { Request, Response } from 'express';
import type { CatalogListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './brands.service.ts';

export async function list(req: Request, res: Response<unknown, { query: CatalogListQuery }>) {
  res.json(await service.list(res.locals.query, actorOf(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await service.update(req.params.id, req.body, actorOf(req)));
}

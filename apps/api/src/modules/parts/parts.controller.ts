import type { Request, Response } from 'express';
import type { PartListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './parts.service.ts';

export async function list(_req: Request, res: Response<unknown, { query: PartListQuery }>) {
  res.json(await service.list(res.locals.query));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await service.update(req.params.id, req.body, actorOf(req)));
}

export async function lookup(req: Request, res: Response<unknown, { query: { code: string; branchId?: string } }>) {
  res.json(await service.lookup(res.locals.query.code, actorOf(req), res.locals.query.branchId));
}

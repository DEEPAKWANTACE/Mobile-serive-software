import type { Request, Response } from 'express';
import type { UserListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './users.service.ts';

export async function list(req: Request, res: Response<unknown, { query: UserListQuery }>) {
  res.json(await service.list(res.locals.query, actorOf(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await service.update(req.params.id, req.body, actorOf(req)));
}

export async function resetPassword(req: Request<{ id: string }>, res: Response) {
  await service.resetPassword(req.params.id, req.body.password, actorOf(req));
  res.status(204).end();
}

export async function setAadhaarPhoto(req: Request<{ id: string }>, res: Response) {
  await service.setAadhaarPhoto(req.params.id, req.file, actorOf(req));
  res.status(204).end();
}

export async function getAadhaarPhoto(req: Request<{ id: string }>, res: Response) {
  const { stream, mimeType } = await service.getAadhaarPhoto(req.params.id, actorOf(req));
  res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  stream.pipe(res);
}

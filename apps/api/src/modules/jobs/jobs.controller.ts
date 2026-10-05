import type { Request, Response } from 'express';
import type { JobListQuery, PhotoKind } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './jobs.service.ts';

export async function list(req: Request, res: Response<unknown, { query: JobListQuery }>) {
  res.json(await service.list(res.locals.query, actorOf(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.body, actorOf(req)));
}

export async function get(req: Request<{ id: string }>, res: Response) {
  res.json(await service.get(req.params.id, actorOf(req)));
}

export async function history(req: Request<{ id: string }>, res: Response) {
  res.json(await service.history(req.params.id, actorOf(req)));
}

export async function addPhotos(req: Request<{ id: string }>, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.status(201).json(await service.addPhotos(req.params.id, req.body.kind as PhotoKind, files, actorOf(req)));
}

export async function getPhoto(req: Request<{ id: string; photoId: string }>, res: Response) {
  const { stream, mimeType } = await service.getPhoto(req.params.id, req.params.photoId, actorOf(req));
  // Sensitive (ID proofs): never cache in shared caches.
  res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  stream.pipe(res);
}

export async function engineers(req: Request, res: Response<unknown, { query: { branchId?: string } }>) {
  res.json(await service.engineers(actorOf(req), res.locals.query.branchId));
}

export async function assign(req: Request<{ id: string }>, res: Response) {
  res.json(await service.assign(req.params.id, req.body.engineerId, actorOf(req)));
}

export async function stats(req: Request, res: Response<unknown, { query: { branchId?: string } }>) {
  res.json(await service.stats(actorOf(req), res.locals.query.branchId));
}

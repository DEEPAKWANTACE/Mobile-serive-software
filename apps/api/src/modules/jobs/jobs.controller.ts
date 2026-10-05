import type { Request, Response } from 'express';
import type { JobListQuery, PhotoKind, TransferListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './jobs.service.ts';
import * as transfers from './transfers.service.ts';
import * as workflow from './workflow.service.ts';

export async function list(req: Request, res: Response<unknown, { query: JobListQuery }>) {
  res.json(await service.list(res.locals.query, actorOf(req)));
}

export async function create(req: Request, res: Response) {
  const photos = (req.files ?? {}) as service.IncomingPhotos;
  res.status(201).json(await service.create(req.body, photos, actorOf(req)));
}

export async function updateDevice(req: Request<{ id: string }>, res: Response) {
  res.json(await service.updateDevice(req.params.id, req.body, actorOf(req)));
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

export async function diagnose(req: Request<{ id: string }>, res: Response) {
  res.json(await workflow.diagnose(req.params.id, req.body, actorOf(req)));
}

export async function decideApproval(req: Request<{ id: string }>, res: Response) {
  res.json(await workflow.decideApproval(req.params.id, req.body, actorOf(req)));
}

export async function changeStatus(req: Request<{ id: string }>, res: Response) {
  res.json(await workflow.changeStatus(req.params.id, req.body, actorOf(req)));
}

export async function spareHold(req: Request<{ id: string }>, res: Response) {
  res.json(await workflow.spareHold(req.params.id, req.body, actorOf(req)));
}

export async function spareReceived(req: Request<{ id: string }>, res: Response) {
  res.json(await workflow.spareReceived(req.params.id, req.body.note, actorOf(req)));
}

export async function rwr(req: Request<{ id: string }>, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.json(await workflow.returnWithoutRepair(req.params.id, req.body, files, actorOf(req)));
}

export async function listTransfers(req: Request, res: Response<unknown, { query: TransferListQuery }>) {
  res.json(await transfers.list(res.locals.query, actorOf(req)));
}

export async function requestTransfer(req: Request<{ id: string }>, res: Response) {
  res.status(201).json(await transfers.request(req.params.id, req.body, actorOf(req)));
}

export async function respondTransfer(req: Request<{ transferId: string }>, res: Response) {
  res.json(await transfers.respond(req.params.transferId, req.body, actorOf(req)));
}

export async function cancelTransfer(req: Request<{ transferId: string }>, res: Response) {
  await transfers.cancel(req.params.transferId, actorOf(req));
  res.status(204).end();
}

import type { Request, Response } from 'express';
import type { MovementListQuery, PartRequestListQuery, StockListQuery } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './inventory.service.ts';

export async function stock(req: Request, res: Response<unknown, { query: StockListQuery }>) {
  res.json(await service.stock(res.locals.query, actorOf(req)));
}
export async function receive(req: Request, res: Response) {
  res.status(201).json(await service.receive(req.body, actorOf(req)));
}
export async function adjust(req: Request, res: Response) {
  res.status(201).json(await service.adjust(req.body, actorOf(req)));
}
export async function movements(req: Request, res: Response<unknown, { query: MovementListQuery }>) {
  res.json(await service.movements(res.locals.query, actorOf(req)));
}
export async function requests(req: Request, res: Response<unknown, { query: PartRequestListQuery }>) {
  res.json(await service.requests(res.locals.query, actorOf(req)));
}
export async function issue(req: Request<{ id: string }>, res: Response) {
  res.json(await service.issue(req.params.id, req.body?.note, actorOf(req)));
}
export async function notAvailable(req: Request<{ id: string }>, res: Response) {
  res.json(await service.markNotAvailable(req.params.id, req.body?.note, actorOf(req)));
}
export async function returnToStock(req: Request<{ id: string }>, res: Response) {
  res.json(await service.returnToStock(req.params.id, req.body?.note, actorOf(req)));
}
export async function cancel(req: Request<{ id: string }>, res: Response) {
  await service.cancel(req.params.id, actorOf(req));
  res.status(204).end();
}
export async function requestPart(req: Request<{ id: string }>, res: Response) {
  res.status(201).json(await service.requestPart(req.params.id, req.body, actorOf(req)));
}

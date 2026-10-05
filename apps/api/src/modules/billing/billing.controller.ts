import type { Request, Response } from 'express';
import { actorOf } from '../../lib/request-context.ts';
import * as service from './billing.service.ts';

export async function preview(req: Request<{ id: string }>, res: Response) {
  res.json(await service.preview(req.params.id, actorOf(req)));
}
export async function deliver(req: Request<{ id: string }>, res: Response) {
  res.status(201).json(await service.deliver(req.params.id, req.body, actorOf(req)));
}
export async function invoice(req: Request<{ id: string }>, res: Response) {
  res.json(await service.getInvoice(req.params.id, actorOf(req)));
}

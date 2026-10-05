import { Router } from 'express';
import { prisma } from '../../lib/prisma.ts';

export const healthRoutes = Router();

healthRoutes.get('/', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
});

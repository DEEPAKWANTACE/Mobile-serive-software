import type { JobPartDto } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';

// Kept separate from inventory.service so the jobs module can use it without an import cycle.

export const jobPartSelect = {
  id: true,
  quantity: true,
  unitPrice: true,
  status: true,
  note: true,
  requestedAt: true,
  handledAt: true,
  part: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  handledBy: { select: { id: true, name: true } },
} satisfies Prisma.JobPartSelect;

type JobPartRow = Prisma.JobPartGetPayload<{ select: typeof jobPartSelect }>;

export const toJobPartDto = (r: JobPartRow): JobPartDto => ({
  ...r,
  unitPrice: r.unitPrice.toNumber(),
  requestedAt: r.requestedAt.toISOString(),
  handledAt: r.handledAt?.toISOString() ?? null,
});

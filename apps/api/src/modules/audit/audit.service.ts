import type { Prisma } from '../../generated/prisma/client.ts';
import { prisma } from '../../lib/prisma.ts';

type DbClient = Pick<typeof prisma, 'auditLog'> | Prisma.TransactionClient;

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Append an audit record. Pass a transaction client to make it atomic with the change it describes. */
export function recordAudit(entry: AuditEntry, db: DbClient = prisma) {
  return db.auditLog.create({ data: entry });
}

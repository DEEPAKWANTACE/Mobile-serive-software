import { ROLES, type CatalogListQuery } from '@msm/shared';
import type { Actor } from './request-context.ts';
import { HttpError } from './http-error.ts';

export function catalogWhere(actor: Actor, query: CatalogListQuery): { OR?: { branchId: string | null }[]; branchId?: string | null } {
  const branchId = actor.branchId ?? query.branchId;
  if (query.scope === 'global') return { branchId: null };
  if (query.scope === 'branch') {
    if (!branchId) throw HttpError.badRequest('Select a branch');
    return { branchId };
  }
  return branchId ? { OR: [{ branchId: null }, { branchId }] } : { branchId: null };
}

export function writeCatalogBranch(actor: Actor, requested?: string | null) {
  if (actor.role === ROLES.SUPER_ADMIN) return requested ?? null;
  if (actor.role === ROLES.BRANCH_MANAGER && actor.branchId) return actor.branchId;
  throw HttpError.forbidden('Only Super Admin or Branch Manager can edit this list');
}

export function assertCatalogRow(actor: Actor, rowBranchId: string | null) {
  if (actor.role === ROLES.SUPER_ADMIN) return;
  if (actor.role === ROLES.BRANCH_MANAGER && actor.branchId === rowBranchId && rowBranchId !== null) return;
  throw HttpError.forbidden('You can edit only your branch list');
}

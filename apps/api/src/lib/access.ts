import { isGlobalRole } from '@msm/shared';
import type { AccessTokenPayload } from './tokens.ts';
import { HttpError } from './http-error.ts';

/**
 * Multi-branch data scoping. Every branch-owned query should be filtered through this
 * so a user can only ever see data from their own branch (Super Admin sees all).
 */
export function branchScope(auth: AccessTokenPayload): { branchId?: string } {
  if (isGlobalRole(auth.role)) return {};
  if (!auth.branchId) throw HttpError.forbidden('User is not assigned to a branch');
  return { branchId: auth.branchId };
}

export function assertBranchAccess(auth: AccessTokenPayload, branchId: string) {
  if (isGlobalRole(auth.role)) return;
  if (auth.branchId !== branchId) throw HttpError.forbidden();
}

import { MANAGER_PERMISSIONS, ROLES, type ManagerPermissionKey, type ManagerPermissionsDto } from '@msm/shared';
import { HttpError } from './http-error.ts';
import { prisma } from './prisma.ts';
import type { Actor } from './request-context.ts';

/**
 * Super Admin can switch individual Branch Manager actions off. No row means allowed.
 * Super Admin is never restricted; other roles are governed by their route rules, not these switches.
 */
export async function can(actor: Actor, key: ManagerPermissionKey) {
  if (actor.role !== ROLES.BRANCH_MANAGER) return true;
  const row = await prisma.permissionOverride.findUnique({ where: { role_key: { role: ROLES.BRANCH_MANAGER, key } }, select: { allowed: true } });
  return row ? row.allowed : true;
}

export async function assertCan(actor: Actor, key: ManagerPermissionKey) {
  if (!(await can(actor, key))) throw HttpError.forbidden('The Super Admin has turned this action off for Branch Managers');
}

export async function managerPermissions(): Promise<ManagerPermissionsDto> {
  const rows = await prisma.permissionOverride.findMany({ where: { role: ROLES.BRANCH_MANAGER }, select: { key: true, allowed: true } });
  const map = new Map(rows.map((r) => [r.key, r.allowed]));
  return MANAGER_PERMISSIONS.map((p) => ({ key: p.key, label: p.label, allowed: map.get(p.key) ?? true }));
}

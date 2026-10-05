import { randomUUID } from 'node:crypto';
import {
  BRANCH_STAFF_ROLES,
  maskAadhaar,
  ROLES,
  type Role,
  type UserCreateData,
  type UserDto,
  type UserListQuery,
  type UserUpdateData,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { branchScope } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { hashPassword } from '../../lib/password.ts';
import { storage } from '../../lib/storage.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  username: true,
  phone: true,
  email: true,
  role: true,
  address: true,
  aadhaarNumber: true,
  aadhaarPhotoKey: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

type Row = Prisma.UserGetPayload<{ select: typeof select }>;

/** Full Aadhaar only when the viewer may manage this user (they need it to edit); masked otherwise. */
const toDto = ({ aadhaarPhotoKey, ...u }: Row, actor?: Actor): UserDto => ({
  ...u,
  aadhaarNumber: u.aadhaarNumber && (actor && canManage(actor, u) ? u.aadhaarNumber : maskAadhaar(u.aadhaarNumber)),
  hasAadhaarPhoto: !!aadhaarPhotoKey,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

const canManage = (actor: Actor, target: { role: Role; branch: { id: string } | null }) =>
  actor.role === ROLES.SUPER_ADMIN ||
  (BRANCH_STAFF_ROLES.includes(target.role) && target.branch?.id === actor.branchId);

const isSuperAdmin = (actor: Actor) => actor.role === ROLES.SUPER_ADMIN;

/** Branch Managers may only handle branch staff roles, and only inside their own branch. */
function assertCanManage(actor: Actor, target: { role: Role; branchId: string | null }) {
  if (isSuperAdmin(actor)) return;
  if (!BRANCH_STAFF_ROLES.includes(target.role) || target.branchId !== actor.branchId) {
    throw HttpError.forbidden('You can only manage CCO, Engineer, Storekeeper and Accounts staff in your branch');
  }
}

/** Super Admin has no branch; every other role must have one. */
function resolveBranch(role: Role, branchId: string | null | undefined) {
  if (role === ROLES.SUPER_ADMIN) return null;
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  return branchId;
}

async function revokeSessions(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function list(query: UserListQuery, actor: Actor) {
  const where: Prisma.UserWhereInput = {
    isActive: query.isActive,
    role: query.role,
    branchId: query.branchId,
    ...branchScope(actor), // overrides branchId filter for non-global roles
    ...(query.search && {
      OR: [{ name: contains(query.search) }, { username: contains(query.search) }, { phone: contains(query.search) }],
    }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
    prisma.user.count({ where }),
  ]);
  return toPage(rows.map((r) => toDto(r, actor)), total, query);
}

export async function create(data: UserCreateData, actor: Actor) {
  const { password, ...fields } = data;
  // Branch Managers always create into their own branch.
  const branchId = resolveBranch(fields.role, isSuperAdmin(actor) ? fields.branchId : actor.branchId);
  assertCanManage(actor, { role: fields.role, branchId });

  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const row = await tx.user.create({ data: { ...fields, branchId, passwordHash }, select });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'user.created',
        entityType: 'user',
        entityId: row.id,
        branchId,
        metadata: { ...fields, branchId },
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row, actor);
  });
}

export async function update(id: string, data: UserUpdateData, actor: Actor) {
  const current = await prisma.user.findUnique({ where: { id }, select: { role: true, branchId: true } });
  if (!current) throw HttpError.notFound('User not found');
  assertCanManage(actor, current);

  const role = data.role ?? current.role;
  const requestedBranch = data.branchId === undefined ? current.branchId : data.branchId;
  const branchId = resolveBranch(role, isSuperAdmin(actor) ? requestedBranch : actor.branchId);
  assertCanManage(actor, { role, branchId });

  const accessChanged =
    role !== current.role || branchId !== current.branchId || (data.isActive !== undefined && !data.isActive);

  if (id === actor.sub && (role !== current.role || branchId !== current.branchId || data.isActive === false)) {
    throw HttpError.forbidden('You cannot change your own role, branch or status');
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.user.update({ where: { id }, data: { ...data, role, branchId }, select });
    // Force re-login so new role/branch/status takes effect (existing access tokens expire within their TTL).
    if (accessChanged) await revokeSessions(tx, id);
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        branchId,
        metadata: data,
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row, actor);
  });
}

export async function resetPassword(id: string, password: string, actor: Actor) {
  const current = await prisma.user.findUnique({ where: { id }, select: { role: true, branchId: true } });
  if (!current) throw HttpError.notFound('User not found');
  assertCanManage(actor, current);

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await revokeSessions(tx, id);
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
        branchId: current.branchId,
        ip: actor.ip,
      },
      tx,
    );
  });
}

// ─── Aadhaar photo (staff KYC) ──────────────────────────────────────────────

async function loadManageable(id: string, actor: Actor) {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, branchId: true, aadhaarPhotoKey: true } });
  if (!user) throw HttpError.notFound('User not found');
  assertCanManage(actor, user);
  return user;
}

export async function setAadhaarPhoto(id: string, file: Express.Multer.File | undefined, actor: Actor) {
  if (!file) throw HttpError.badRequest('No photo uploaded');
  const user = await loadManageable(id, actor);
  const type = detectImageType(file.buffer);
  if (!type) throw HttpError.badRequest('Photo must be a JPEG, PNG or WebP image');

  const key = `staff/${id}/aadhaar-${randomUUID()}.${type.ext}`;
  await storage.put(key, file.buffer);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { aadhaarPhotoKey: key } });
      await recordAudit(
        { actorId: actor.sub, action: 'user.aadhaar_photo_set', entityType: 'user', entityId: id, branchId: user.branchId, ip: actor.ip },
        tx,
      );
    });
  } catch (err) {
    await storage.delete(key);
    throw err;
  }
  if (user.aadhaarPhotoKey) await storage.delete(user.aadhaarPhotoKey).catch(() => undefined);
}

export async function getAadhaarPhoto(id: string, actor: Actor) {
  const user = await loadManageable(id, actor);
  if (!user.aadhaarPhotoKey) throw HttpError.notFound('No Aadhaar photo');
  const ext = user.aadhaarPhotoKey.split('.').pop();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { stream: await storage.get(user.aadhaarPhotoKey), mimeType };
}

import { ROLES, type CategoryQuery, type PartCategoryDto } from '@msm/shared';
import { assertBranchAccess } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';

/**
 * Part categories / subcategories. Parts store the names as text; this master list lets managers and store keepers
 * create entries before any part uses them, and rename or remove them in one place.
 */

function writeBranch(actor: Actor, requested?: string | null) {
  if (actor.role === ROLES.SUPER_ADMIN) return requested ?? null;
  if ((actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.STOREKEEPER) && actor.branchId) return actor.branchId;
  throw HttpError.forbidden('Only Super Admin, Branch Manager or Store Keeper can manage categories');
}

export async function list(query: CategoryQuery, actor: Actor): Promise<PartCategoryDto[]> {
  const branchId = actor.branchId ?? query.branchId;
  const scope = query.scope === 'global' ? { branchId: null } : query.scope === 'branch' && branchId ? { branchId } : branchId ? { OR: [{ branchId: null }, { branchId }] } : { branchId: null };
  const [used, master] = await Promise.all([
    prisma.part.groupBy({ by: ['category', 'subcategory'], where: scope, _count: { _all: true } }),
    prisma.partCategory.findMany({ where: scope, select: { id: true, name: true, parentId: true } }),
  ]);
  const tree = new Map<string, { count: number; subs: Map<string, number> }>();
  const cat = (name: string) => tree.get(name) ?? tree.set(name, { count: 0, subs: new Map() }).get(name)!;
  for (const u of used) {
    if (!u.category) continue;
    const c = cat(u.category);
    c.count += u._count._all;
    if (u.subcategory) c.subs.set(u.subcategory, (c.subs.get(u.subcategory) ?? 0) + u._count._all);
  }
  const byId = new Map(master.map((m) => [m.id, m]));
  for (const m of master) {
    if (!m.parentId) cat(m.name);
  }
  for (const m of master) {
    if (m.parentId) {
      const parent = byId.get(m.parentId);
      if (parent) {
        const c = cat(parent.name);
        if (!c.subs.has(m.name)) c.subs.set(m.name, 0);
      }
    }
  }
  return [...tree]
    .map(([name, v]) => ({ name, count: v.count, subcategories: [...v.subs].map(([n, count]) => ({ name: n, count })).sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function create(data: { name: string; parent?: string; branchId?: string | null }, actor: Actor) {
  const branchId = writeBranch(actor, data.branchId);
  await prisma.$transaction(async (tx) => {
    let parent = data.parent ? await tx.partCategory.findFirst({ where: { branchId, name: data.parent, parentId: null } }) : null;
    if (data.parent && !parent) parent = await tx.partCategory.create({ data: { branchId, name: data.parent } });
    const exists = await tx.partCategory.findFirst({ where: { branchId, name: { equals: data.name, mode: 'insensitive' }, parentId: parent?.id ?? null } });
    if (exists) throw HttpError.conflict(`${data.parent ? 'Subcategory' : 'Category'} “${data.name}” already exists`);
    const row = await tx.partCategory.create({ data: { branchId, name: data.name, parentId: parent?.id ?? null } });
    await recordAudit({ actorId: actor.sub, action: 'part_category.created', entityType: 'part_category', entityId: row.id, branchId, metadata: { name: data.name, parent: data.parent ?? null }, ip: actor.ip }, tx);
  });
}

export async function rename(data: { from: string; to: string; parent?: string; branchId?: string | null }, actor: Actor) {
  const branchId = writeBranch(actor, data.branchId);
  if (branchId) assertBranchAccess(actor, branchId);
  await prisma.$transaction(async (tx) => {
    let parts: number;
    if (data.parent) {
      parts = (await tx.part.updateMany({ where: { branchId, category: data.parent, subcategory: data.from }, data: { subcategory: data.to } })).count;
      const parent = await tx.partCategory.findFirst({ where: { branchId, name: data.parent, parentId: null }, select: { id: true } });
      if (parent) await tx.partCategory.updateMany({ where: { branchId, parentId: parent.id, name: data.from }, data: { name: data.to } });
    } else {
      parts = (await tx.part.updateMany({ where: { branchId, category: data.from }, data: { category: data.to } })).count;
      await tx.partCategory.updateMany({ where: { branchId, parentId: null, name: data.from }, data: { name: data.to } });
    }
    await recordAudit({ actorId: actor.sub, action: 'part_category.renamed', entityType: 'part_category', entityId: data.from, branchId, metadata: { ...data, partsUpdated: parts }, ip: actor.ip }, tx);
  });
}

export async function remove(data: { name: string; parent?: string; branchId?: string | null }, actor: Actor) {
  const branchId = writeBranch(actor, data.branchId);
  const inUse = await prisma.part.count({ where: { branchId, ...(data.parent ? { category: data.parent, subcategory: data.name } : { category: data.name }) } });
  if (inUse) throw HttpError.conflict(`${inUse} part${inUse === 1 ? ' uses' : 's use'} “${data.name}”. Move or rename them first.`);
  await prisma.$transaction(async (tx) => {
    if (data.parent) {
      const parent = await tx.partCategory.findFirst({ where: { branchId, name: data.parent, parentId: null }, select: { id: true } });
      if (parent) await tx.partCategory.deleteMany({ where: { branchId, parentId: parent.id, name: data.name } });
    } else {
      const cat = await tx.partCategory.findFirst({ where: { branchId, name: data.name, parentId: null }, select: { id: true } });
      if (cat) {
        await tx.partCategory.deleteMany({ where: { parentId: cat.id } });
        await tx.partCategory.delete({ where: { id: cat.id } });
      }
    }
    await recordAudit({ actorId: actor.sub, action: 'part_category.deleted', entityType: 'part_category', entityId: data.name, branchId, metadata: { ...data }, ip: actor.ip }, tx);
  });
}

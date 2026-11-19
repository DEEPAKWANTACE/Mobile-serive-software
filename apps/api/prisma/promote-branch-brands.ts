/**
 * One-off: move every brand (and its models) of a branch into the Super Admin global defaults.
 * Usage: npx tsx --env-file=.env prisma/promote-branch-brands.ts T1
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { promoteBrandToGlobal } from '../src/modules/brands/brands.service.ts';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const code = process.argv[2];
  if (!code) throw new Error('Pass the branch code, e.g. T1');
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code }, select: { id: true, name: true } });
  const brands = await prisma.brand.findMany({ where: { branchId: branch.id }, select: { id: true }, orderBy: { name: 'asc' } });
  console.log(`${branch.name} (${code}): ${brands.length} branch brands`);
  for (const b of brands) {
    const r = await prisma.$transaction((tx) => promoteBrandToGlobal(tx, b.id));
    console.log(`  ${r.brand}: ${r.merged ? 'merged into global' : 'moved to global'} — ${r.moved} models moved${r.kept ? `, ${r.kept} duplicates kept on branch` : ''}`);
  }
}

main().finally(() => prisma.$disconnect());

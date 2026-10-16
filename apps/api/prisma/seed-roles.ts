import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/password.ts';

/**
 * Idempotent demo seed: creates one account for every Role.
 * Non-global roles require a branch, so a demo State -> City -> Branch is
 * ensured first. Safe to re-run; it upserts by unique keys.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const PASSWORD = process.env.SEED_ROLE_PASSWORD ?? 'ChangeMe@2026';

const ACCOUNTS = [
  { role: 'SUPER_ADMIN', username: 'superadmin', name: 'Super Admin (demo)', scoped: false },
  { role: 'BRANCH_MANAGER', username: 'manager', name: 'Branch Manager', scoped: true },
  { role: 'CCO', username: 'cco', name: 'Customer Care Officer', scoped: true },
  { role: 'ENGINEER', username: 'engineer', name: 'Engineer', scoped: true },
  { role: 'STOREKEEPER', username: 'storekeeper', name: 'Storekeeper', scoped: true },
  { role: 'ACCOUNTS', username: 'accounts', name: 'Accounts', scoped: true },
] as const;

async function main() {
  if (PASSWORD.length < 8) throw new Error('SEED_ROLE_PASSWORD must be at least 8 chars');

  const state = await prisma.state.upsert({
    where: { code: 'DS' },
    update: {},
    create: { name: 'Demo State', code: 'DS' },
  });

  let city = await prisma.city.findFirst({ where: { stateId: state.id, name: 'Demo City' } });
  if (!city) city = await prisma.city.create({ data: { stateId: state.id, name: 'Demo City' } });

  const branch = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { cityId: city.id, code: 'MAIN', name: 'Main Branch', type: 'MAIN_OFFICE' },
  });

  const passwordHash = await hashPassword(PASSWORD);

  for (const acc of ACCOUNTS) {
    const branchId = acc.scoped ? branch.id : null;
    await prisma.user.upsert({
      where: { username: acc.username },
      update: { role: acc.role, name: acc.name, branchId, passwordHash, isActive: true },
      create: { username: acc.username, role: acc.role, name: acc.name, branchId, passwordHash },
    });
    console.log(`  ${acc.role.padEnd(14)} -> username="${acc.username}"`);
  }

  console.log(`\nAll ${ACCOUNTS.length} role accounts ready. Password for every account: ${PASSWORD}`);
  console.log(`Branch for scoped roles: ${branch.name} (code ${branch.code}) in Demo City, Demo State.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

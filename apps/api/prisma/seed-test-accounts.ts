import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Role } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/password.ts';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const password = process.env.TEST_ACCOUNTS_PASSWORD ?? 'a';
  const passwordHash = await hashPassword(password);
  const state = await prisma.state.upsert({ where: { code: 'TST' }, update: { isActive: true }, create: { code: 'TST', name: 'Test State' } });
  const city = (await prisma.city.findFirst({ where: { stateId: state.id, name: 'Test City' } })) ??
    (await prisma.city.create({ data: { stateId: state.id, name: 'Test City' } }));
  const branch = await prisma.branch.upsert({
    where: { code: 'B1' },
    update: { name: 'b1', cityId: city.id, isActive: true },
    create: { code: 'B1', name: 'b1', cityId: city.id, type: 'SERVICE_CENTER' },
  });
  const defs: { username: string; name: string; role: Role; branchId: string | null }[] = [
    { username: process.env.TEST_SA_USERNAME ?? 'sa', name: 'Test Super Admin', role: 'SUPER_ADMIN', branchId: null },
    { username: process.env.TEST_BM_USERNAME ?? 'bm', name: 'Test Branch Manager', role: 'BRANCH_MANAGER', branchId: branch.id },
    { username: process.env.TEST_CCO_USERNAME ?? 'cco', name: 'Test CCO', role: 'CCO', branchId: branch.id },
    { username: process.env.TEST_ENGINEER_USERNAME ?? 'eng', name: 'Test Engineer', role: 'ENGINEER', branchId: branch.id },
    { username: process.env.TEST_STORE_USERNAME ?? 'store', name: 'Test Storekeeper', role: 'STOREKEEPER', branchId: branch.id },
    { username: process.env.TEST_ACCOUNTS_USERNAME ?? 'acc', name: 'Test Accounts', role: 'ACCOUNTS', branchId: branch.id },
  ];
  for (const user of defs) {
    await prisma.user.upsert({
      where: { username: user.username },
      update: { ...user, passwordHash, passwordChangedAt: new Date(), isActive: true },
      create: { ...user, passwordHash, passwordChangedAt: new Date(), isActive: true },
    });
  }
  console.log(`Temporary test accounts ready for branch ${branch.code}: ${defs.map((u) => u.username).join(', ')}`);
}

main().finally(() => prisma.$disconnect());

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/password.ts';

/**
 * Idempotent bootstrap seed: creates the initial Super Admin only.
 * States, cities, branches and staff are created through the application.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be set (min 8 chars)');

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Super Admin "${username}" already exists, skipping.`);
    return;
  }

  await prisma.user.create({
    data: { name: 'Super Admin', username, role: 'SUPER_ADMIN', passwordHash: await hashPassword(password) },
  });
  console.log(`Created Super Admin "${username}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

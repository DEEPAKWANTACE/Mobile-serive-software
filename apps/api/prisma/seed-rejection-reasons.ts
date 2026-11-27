import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';

/**
 * Idempotent: adds the standard global customer rejection reasons that are missing (matched by name,
 * ignoring case). Existing rows are left alone, so a reason a Super Admin deactivated stays deactivated.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const REASONS = [
  'Too costly',
  'Will buy a new phone',
  'Repair takes too long',
  'Will repair elsewhere',
  'Data / phone not needed now',
  'Phone too old, not worth repairing',
  'Waiting time for spare too long',
  'Wants original / company part only',
  'Will go to the brand service centre',
  'Not happy with repair warranty',
  'Only wanted data backup',
  'Family member declined',
  'Will decide later',
];

async function main() {
  const existing = await prisma.rejectionReason.findMany({ where: { branchId: null }, select: { name: true, sortOrder: true } });
  const have = new Set(existing.map((r) => r.name.toLowerCase()));
  let sortOrder = Math.max(0, ...existing.map((r) => r.sortOrder));
  const missing = REASONS.filter((name) => !have.has(name.toLowerCase()));
  for (const name of missing) {
    sortOrder += 10;
    await prisma.rejectionReason.create({ data: { name, sortOrder, branchId: null } });
  }
  console.log(missing.length ? `Added ${missing.length} rejection reason(s): ${missing.join(', ')}` : 'All rejection reasons already present.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

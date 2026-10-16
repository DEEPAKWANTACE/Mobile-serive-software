import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Role } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/password.ts';

/**
 * Comprehensive demo seed: populates every model in the schema with a small,
 * internally-consistent dataset. Masters are upserted (idempotent); the
 * transactional block (jobs, payments, invoices, movements, …) is created once
 * and skipped on re-run, keyed off the sentinel job number SC01-2610-0001.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const PASSWORD = process.env.SEED_ROLE_PASSWORD ?? 'ChangeMe@2026';
const d = (s: string) => new Date(s);

/** Build an assertive getter over a lookup map so reads are typed `string`, not `string | undefined`. */
const getter = (map: Record<string, string>, kind: string) => (key: string): string => {
  const v = map[key];
  if (v === undefined) throw new Error(`Unknown ${kind}: ${key}`);
  return v;
};

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  // ── Shop settings (single row) ───────────────────────────────────────────
  await prisma.shopSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      shopName: 'QuickFix Mobile Service',
      legalName: 'QuickFix Services Pvt Ltd',
      gstin: '27ABCDE1234F1Z5',
      address: '12 MG Road, Demo City, Demo State - 400001',
      phone: '+91 98200 00000',
      email: 'care@quickfix.example',
      invoiceTerms: 'Goods once serviced will not be taken back. Warranty 30 days on repair only.',
    },
  });

  // ── Geography & branches ─────────────────────────────────────────────────
  const state = await prisma.state.upsert({ where: { code: 'DS' }, update: {}, create: { name: 'Demo State', code: 'DS' } });
  let city = await prisma.city.findFirst({ where: { stateId: state.id, name: 'Demo City' } });
  if (!city) city = await prisma.city.create({ data: { stateId: state.id, name: 'Demo City' } });

  const mainOffice = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { cityId: city.id, code: 'MAIN', name: 'Main Branch', type: 'MAIN_OFFICE', phone: '+91 98200 00001' },
  });
  const serviceCenter = await prisma.branch.upsert({
    where: { code: 'SC01' },
    update: {},
    create: { cityId: city.id, code: 'SC01', name: 'MG Road Service Center', type: 'SERVICE_CENTER', phone: '+91 98200 00002', address: '12 MG Road, Demo City' },
  });

  // ── Users: one per role (+ a second engineer for transfers) ──────────────
  const userDefs = [
    { role: 'SUPER_ADMIN', username: 'superadmin', name: 'Super Admin (demo)', branchId: null, email: 'superadmin@quickfix.example', phone: '+91 90000 00001' },
    { role: 'BRANCH_MANAGER', username: 'manager', name: 'Branch Manager', branchId: serviceCenter.id, email: 'manager@quickfix.example', phone: '+91 90000 00002' },
    { role: 'CCO', username: 'cco', name: 'Customer Care Officer', branchId: serviceCenter.id, email: 'cco@quickfix.example', phone: '+91 90000 00003' },
    { role: 'ENGINEER', username: 'engineer', name: 'Engineer One', branchId: serviceCenter.id, email: 'engineer1@quickfix.example', phone: '+91 90000 00004' },
    { role: 'ENGINEER', username: 'engineer2', name: 'Engineer Two', branchId: serviceCenter.id, email: 'engineer2@quickfix.example', phone: '+91 90000 00005' },
    { role: 'STOREKEEPER', username: 'storekeeper', name: 'Storekeeper', branchId: serviceCenter.id, email: 'store@quickfix.example', phone: '+91 90000 00006' },
    { role: 'ACCOUNTS', username: 'accounts', name: 'Accounts', branchId: serviceCenter.id, email: 'accounts@quickfix.example', phone: '+91 90000 00007' },
  ] satisfies Array<{ role: Role; username: string; name: string; branchId: string | null; email: string; phone: string }>;
  const users: Record<string, string> = {};
  for (const u of userDefs) {
    const row = await prisma.user.upsert({
      where: { username: u.username },
      update: { role: u.role, name: u.name, branchId: u.branchId, email: u.email, phone: u.phone, isActive: true, passwordChangedAt: new Date() },
      create: { username: u.username, role: u.role, name: u.name, branchId: u.branchId, email: u.email, phone: u.phone, passwordHash, passwordChangedAt: new Date(), address: 'Demo City', aadhaarNumber: '123412341234' },
    });
    users[u.username] = row.id;
  }
  const user = getter(users, 'user');

  // ── Session (refresh-token rows) ─────────────────────────────────────────
  const mkSession = async (username: string, seed: string, agent: string) => {
    const tokenHash = createHash('sha256').update(seed).digest('hex');
    await prisma.session.upsert({
      where: { tokenHash },
      update: {},
      create: { userId: user(username), tokenHash, expiresAt: d('2027-01-01T00:00:00Z'), userAgent: agent, ip: '127.0.0.1' },
    });
  };
  await mkSession('superadmin', 'seed-refresh-token', 'SeedScript/1.0');
  for (const uname of ['engineer', 'cco', 'manager']) await mkSession(uname, 'seed-refresh-' + uname, 'SeedScript/1.0 (' + uname + ')');

  // ── Device catalogue ─────────────────────────────────────────────────────
  const brands: Record<string, string> = {};
  for (const name of ['Samsung', 'Apple', 'Xiaomi']) {
    const b = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    brands[name] = b.id;
  }
  const brand = getter(brands, 'brand');

  const modelDefs = [
    { brand: 'Samsung', name: 'Galaxy S21' },
    { brand: 'Samsung', name: 'Galaxy A52' },
    { brand: 'Apple', name: 'iPhone 12' },
    { brand: 'Apple', name: 'iPhone 13' },
    { brand: 'Xiaomi', name: 'Redmi Note 10' },
  ];
  const models: Record<string, string> = {};
  for (const m of modelDefs) {
    const row = await prisma.deviceModel.upsert({
      where: { brandId_name: { brandId: brand(m.brand), name: m.name } },
      update: {},
      create: { brandId: brand(m.brand), name: m.name },
    });
    models[m.name] = row.id;
  }
  const model = getter(models, 'model');

  // ── Fault categories & faults ────────────────────────────────────────────
  const catDefs = [
    { name: 'Display', sortOrder: 1 },
    { name: 'Battery', sortOrder: 2 },
    { name: 'Software', sortOrder: 3 },
    { name: 'Water Damage', sortOrder: 4 },
  ];
  const cats: Record<string, string> = {};
  for (const c of catDefs) {
    const row = await prisma.faultCategory.upsert({ where: { name: c.name }, update: {}, create: c });
    cats[c.name] = row.id;
  }
  const cat = getter(cats, 'fault category');

  const faultDefs = [
    { name: 'Screen Broken', category: 'Display', requiresIdProof: false, description: undefined as string | undefined },
    { name: 'Touch Not Working', category: 'Display', requiresIdProof: false, description: undefined as string | undefined },
    { name: 'Not Charging', category: 'Battery', requiresIdProof: false, description: undefined as string | undefined },
    { name: 'Battery Backup Issue', category: 'Battery', requiresIdProof: false, description: undefined as string | undefined },
    { name: 'Software Unlock', category: 'Software', requiresIdProof: true, description: 'Pattern / FRP unlock — needs customer ID proof.' },
    { name: 'Water Damaged', category: 'Water Damage', requiresIdProof: false, description: undefined as string | undefined },
  ];
  const faults: Record<string, string> = {};
  for (const f of faultDefs) {
    const row = await prisma.fault.upsert({
      where: { name: f.name },
      update: {},
      create: { name: f.name, categoryId: cat(f.category), requiresIdProof: f.requiresIdProof, description: f.description },
    });
    faults[f.name] = row.id;
  }
  const fault = getter(faults, 'fault');

  // ── Service prices (model + fault + label) ───────────────────────────────
  const priceDefs = [
    { model: 'Galaxy S21', fault: 'Screen Broken', label: 'Copy', price: 3500 },
    { model: 'Galaxy S21', fault: 'Screen Broken', label: 'OG', price: 7500 },
    { model: 'Galaxy S21', fault: 'Not Charging', label: 'Standard', price: 1200 },
    { model: 'iPhone 12', fault: 'Screen Broken', label: 'OG', price: 9500 },
    { model: 'iPhone 12', fault: 'Screen Broken', label: 'Original', price: 14500 },
    { model: 'iPhone 12', fault: 'Battery Backup Issue', label: 'Standard', price: 3500 },
    { model: 'Redmi Note 10', fault: 'Touch Not Working', label: 'Copy', price: 1800 },
    { model: 'Redmi Note 10', fault: 'Not Charging', label: 'Standard', price: 900 },
  ];
  for (const p of priceDefs) {
    await prisma.servicePrice.upsert({
      where: { deviceModelId_faultId_label: { deviceModelId: model(p.model), faultId: fault(p.fault), label: p.label } },
      update: { price: p.price },
      create: { deviceModelId: model(p.model), faultId: fault(p.fault), label: p.label, price: p.price },
    });
  }

  // ── Parts & stock ────────────────────────────────────────────────────────
  const partDefs = [
    { code: '105', name: 'Display — Galaxy S21 (Copy)', brand: 'Samsung', model: 'Galaxy S21', sellingPrice: 3500, costPrice: 2200, reorderLevel: 2 },
    { code: '210', name: 'Battery — iPhone 12', brand: 'Apple', model: 'iPhone 12', sellingPrice: 2500, costPrice: 1500, reorderLevel: 3 },
    { code: '330', name: 'Charging Port — Redmi Note 10', brand: 'Xiaomi', model: 'Redmi Note 10', sellingPrice: 600, costPrice: 250, reorderLevel: 5 },
    { code: '900', name: 'Tempered Glass (universal)', brand: null, model: null, sellingPrice: 150, costPrice: 40, reorderLevel: 10 },
  ];
  const parts: Record<string, string> = {};
  for (const p of partDefs) {
    const row = await prisma.part.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code, name: p.name, sellingPrice: p.sellingPrice, costPrice: p.costPrice, reorderLevel: p.reorderLevel,
        brandId: p.brand ? brand(p.brand) : null, deviceModelId: p.model ? model(p.model) : null,
      },
    });
    parts[p.code] = row.id;
  }
  const part = getter(parts, 'part');

  // Stock at both branches
  const stockDefs = [
    { code: '105', branchId: serviceCenter.id, qty: 5 },
    { code: '210', branchId: serviceCenter.id, qty: 8 },
    { code: '330', branchId: serviceCenter.id, qty: 12 },
    { code: '900', branchId: serviceCenter.id, qty: 40 },
    { code: '105', branchId: mainOffice.id, qty: 3 },
    { code: '210', branchId: mainOffice.id, qty: 2 },
  ];
  for (const s of stockDefs) {
    await prisma.partStock.upsert({
      where: { partId_branchId: { partId: part(s.code), branchId: s.branchId } },
      update: { quantity: s.qty },
      create: { partId: part(s.code), branchId: s.branchId, quantity: s.qty },
    });
  }

  // ── Customers ──────────────────────────────────────────────────────────
  const custDefs = [
    { name: 'Rahul Sharma', phone: '+919812345670', email: 'rahul@example.com', address: 'Flat 4, Sea View, Demo City', city: 'Demo City', altPhone: '+919812345671' },
    { name: 'Priya Nair', phone: '+919812345680', email: 'priya@example.com', address: '22 Hill Road, Demo City', city: 'Demo City' },
    { name: 'Imran Khan', phone: '+919812345690', address: 'Shop 9, Market Lane, Demo City', city: 'Demo City' },
  ];
  const customers: Record<string, string> = {};
  for (const c of custDefs) {
    const row = await prisma.customer.upsert({ where: { phone: c.phone }, update: {}, create: c });
    customers[c.phone] = row.id;
  }
  const cust = getter(customers, 'customer');

  // ── Job counters ─────────────────────────────────────────────────────────
  const counterDefs = [
    { branchId: serviceCenter.id, period: '2610', lastSeq: 5 },
    { branchId: serviceCenter.id, period: '2609', lastSeq: 18 },
    { branchId: mainOffice.id, period: '2610', lastSeq: 2 },
  ];
  for (const c of counterDefs) {
    await prisma.jobCounter.upsert({
      where: { branchId_period: { branchId: c.branchId, period: c.period } },
      update: { lastSeq: c.lastSeq },
      create: c,
    });
  }

  // ── Transactional block: created once ─────────────────────────────────────
  const sentinel = 'SC01-2610-0001';
  if (await prisma.job.findUnique({ where: { jobNumber: sentinel } })) {
    console.log('Transactional data already seeded (found ' + sentinel + '); masters refreshed, skipping jobs.');
    await summary();
    return;
  }

  const branchId = serviceCenter.id;
  const eng1 = user('engineer'), eng2 = user('engineer2'), ccoId = user('cco'), storeId = user('storekeeper'), acctId = user('accounts'), mgrId = user('manager');

  // JOB 1 — fully delivered: faults, estimate, part issued, invoice, payments, history, assignment closed, photos, call
  const job1 = await prisma.job.create({
    data: {
      jobNumber: 'SC01-2610-0001', branchId, currentBranchId: branchId,
      customerId: cust('+919812345670'), brandId: brand('Samsung'), deviceModelId: model('Galaxy S21'),
      imei: '350000000000011', serialNumber: 'SN-S21-001', color: 'Phantom Black',
      customerComplaint: 'Screen cracked after a fall', conditionNotes: 'Minor dents on frame',
      accessories: ['SIM Tray', 'Back Cover'], warranty: 'OUT_OF_WARRANTY', phoneDamaged: true,
      estimatedAmount: 3500, quotedAmount: 3650, approvedAmount: 3650, approvedAt: d('2026-10-02T10:00:00Z'), approvedById: ccoId,
      customerResponse: 'Approved over call', status: 'DELIVERED',
      assignedEngineerId: eng1, assignedAt: d('2026-10-01T11:00:00Z'),
      diagnosisNotes: 'Display assembly cracked; replaced with copy panel', diagnosedAt: d('2026-10-01T12:30:00Z'),
      repairRemark: 'Replaced display, cleaned connectors', repairedAt: d('2026-10-02T14:00:00Z'),
      testingRemark: 'Touch & display OK', testingAt: d('2026-10-02T15:00:00Z'), readyAt: d('2026-10-02T15:30:00Z'),
      deliveredAt: d('2026-10-03T10:00:00Z'), deliveredById: ccoId, deliveredTo: 'Rahul Sharma', deliveryNote: 'Collected in person',
      inwardById: ccoId, createdById: ccoId, createdAt: d('2026-10-01T10:30:00Z'),
      faults: { create: [{ faultId: fault('Screen Broken'), priceLabel: 'Copy', price: 3500 }] },
      estimateLines: {
        create: [
          { faultId: fault('Screen Broken'), priceLabel: 'Copy', description: 'Display replacement', amount: 3500, sortOrder: 0, partId: part('105') },
          { description: 'Service charge', amount: 150, sortOrder: 1 },
        ],
      },
    },
  });
  // part issued on job1 + stock ledger
  await prisma.jobPart.create({ data: { jobId: job1.id, partId: part('105'), quantity: 1, unitPrice: 3500, status: 'ISSUED', requestedById: eng1, requestedAt: d('2026-10-01T13:00:00Z'), handledById: storeId, handledAt: d('2026-10-01T13:10:00Z') } });
  await prisma.stockMovement.create({ data: { partId: part('105'), branchId, type: 'ISSUE', quantity: -1, balanceAfter: 4, unitCost: 2200, jobId: job1.id, note: 'Issued to job ' + job1.jobNumber, createdById: storeId } });
  // photos
  await prisma.jobPhoto.createMany({ data: [
    { jobId: job1.id, kind: 'CUSTOMER', storageKey: 'seed/' + randomUUID() + '.jpg', mimeType: 'image/jpeg', sizeBytes: 102400, uploadedById: ccoId },
    { jobId: job1.id, kind: 'DEVICE', storageKey: 'seed/' + randomUUID() + '.jpg', mimeType: 'image/jpeg', sizeBytes: 204800, uploadedById: eng1 },
  ] });
  // status history
  await prisma.jobStatusHistory.createMany({ data: [
    { jobId: job1.id, fromStatus: null, toStatus: 'RECEIVED', changedById: ccoId, changedAt: d('2026-10-01T10:30:00Z') },
    { jobId: job1.id, fromStatus: 'RECEIVED', toStatus: 'ASSIGNED', engineerId: eng1, changedById: ccoId, changedAt: d('2026-10-01T11:00:00Z') },
    { jobId: job1.id, fromStatus: 'ASSIGNED', toStatus: 'IN_REPAIR', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-01T13:00:00Z') },
    { jobId: job1.id, fromStatus: 'IN_REPAIR', toStatus: 'REPAIRED', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-02T14:00:00Z') },
    { jobId: job1.id, fromStatus: 'REPAIRED', toStatus: 'TESTING', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-02T15:00:00Z') },
    { jobId: job1.id, fromStatus: 'TESTING', toStatus: 'READY_FOR_DELIVERY', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-02T15:30:00Z') },
    { jobId: job1.id, fromStatus: 'READY_FOR_DELIVERY', toStatus: 'DELIVERED', changedById: ccoId, changedAt: d('2026-10-03T10:00:00Z') },
  ] });
  await prisma.jobAssignment.create({ data: { jobId: job1.id, engineerId: eng1, assignedById: ccoId, assignedAt: d('2026-10-01T11:00:00Z'), endedAt: d('2026-10-03T10:00:00Z'), endReason: 'CLOSED', note: 'Completed and delivered' } });
  // invoice + lines
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-SC01-2610-0001', jobId: job1.id, branchId, subtotal: 3650, discount: 150, discountReason: 'Regular customer', total: 3500, createdById: ccoId, createdAt: d('2026-10-03T10:00:00Z'),
      lines: { create: [ { description: 'Display replacement (Copy)', amount: 3500, sortOrder: 0 }, { description: 'Service charge', amount: 150, sortOrder: 1 } ] },
    },
  });
  // payments: advance + final (linked to invoice)
  await prisma.payment.createMany({ data: [
    { jobId: job1.id, branchId, kind: 'ADVANCE', mode: 'UPI', amount: 1000, reference: 'UPI-ADV-001', receivedById: ccoId, createdAt: d('2026-10-01T10:35:00Z') },
    { jobId: job1.id, branchId, invoiceId: inv1.id, kind: 'FINAL', mode: 'CASH', amount: 2500, receivedById: ccoId, createdAt: d('2026-10-03T10:00:00Z') },
  ] });
  await prisma.callLog.create({ data: { jobId: job1.id, branchId, purpose: 'READY_PICKUP', outcome: 'WILL_COLLECT', note: 'Customer will come tomorrow morning', createdById: ccoId, createdAt: d('2026-10-02T16:00:00Z') } });

  // JOB 2 — in repair, pending engineer-to-engineer transfer, part requested
  const job2 = await prisma.job.create({
    data: {
      jobNumber: 'SC01-2610-0002', branchId, currentBranchId: branchId,
      customerId: cust('+919812345680'), brandId: brand('Apple'), deviceModelId: model('iPhone 12'),
      imei: '350000000000022', color: 'Blue', customerComplaint: 'Battery drains fast', warranty: 'OUT_OF_WARRANTY',
      accessories: ['Charger'], estimatedAmount: 3500, quotedAmount: 3500, status: 'IN_REPAIR',
      assignedEngineerId: eng1, assignedAt: d('2026-10-14T11:00:00Z'), diagnosisNotes: 'Battery health 72%, needs replacement', diagnosedAt: d('2026-10-14T12:00:00Z'),
      inwardById: ccoId, createdById: ccoId, createdAt: d('2026-10-14T10:30:00Z'),
      faults: { create: [{ faultId: fault('Battery Backup Issue'), priceLabel: 'Standard', price: 3500 }] },
      estimateLines: { create: [{ faultId: fault('Battery Backup Issue'), priceLabel: 'Standard', description: 'Battery replacement', amount: 3500, sortOrder: 0, partId: part('210') }] },
    },
  });
  await prisma.jobPart.create({ data: { jobId: job2.id, partId: part('210'), quantity: 1, unitPrice: 2500, status: 'REQUESTED', note: 'Need iPhone 12 battery', requestedById: eng1, requestedAt: d('2026-10-14T12:30:00Z') } });
  await prisma.jobStatusHistory.createMany({ data: [
    { jobId: job2.id, fromStatus: null, toStatus: 'RECEIVED', changedById: ccoId, changedAt: d('2026-10-14T10:30:00Z') },
    { jobId: job2.id, fromStatus: 'RECEIVED', toStatus: 'ASSIGNED', engineerId: eng1, changedById: ccoId, changedAt: d('2026-10-14T11:00:00Z') },
    { jobId: job2.id, fromStatus: 'ASSIGNED', toStatus: 'IN_REPAIR', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-14T12:00:00Z') },
  ] });
  await prisma.jobAssignment.create({ data: { jobId: job2.id, engineerId: eng1, assignedById: ccoId, assignedAt: d('2026-10-14T11:00:00Z') } });
  await prisma.jobTransfer.create({ data: { jobId: job2.id, fromEngineerId: eng1, toEngineerId: eng2, reason: 'Needs micro-soldering specialist', status: 'PENDING', heldSince: d('2026-10-14T11:00:00Z'), createdAt: d('2026-10-15T09:00:00Z') } });
  await prisma.payment.create({ data: { jobId: job2.id, branchId, kind: 'ADVANCE', mode: 'CARD', amount: 1500, reference: 'CARD-ADV-002', receivedById: ccoId, createdAt: d('2026-10-14T10:40:00Z') } });

  // JOB 3 — spare pending + follow-up call
  const job3 = await prisma.job.create({
    data: {
      jobNumber: 'SC01-2610-0003', branchId, currentBranchId: branchId,
      customerId: cust('+919812345690'), brandId: brand('Xiaomi'), deviceModelId: model('Redmi Note 10'),
      imei: '350000000000033', color: 'Grey', customerComplaint: 'Not charging', warranty: 'OUT_OF_WARRANTY',
      accessories: [], accessoriesOther: 'None', estimatedAmount: 900, quotedAmount: 900, status: 'SPARE_PENDING',
      assignedEngineerId: eng2, assignedAt: d('2026-10-13T11:00:00Z'), diagnosisNotes: 'Charging port damaged', diagnosedAt: d('2026-10-13T12:00:00Z'),
      sparePart: 'Charging Port — Redmi Note 10', spareRequestedAt: d('2026-10-13T12:30:00Z'), statusBeforeHold: 'IN_REPAIR',
      inwardById: ccoId, createdById: ccoId, createdAt: d('2026-10-13T10:30:00Z'),
      faults: { create: [{ faultId: fault('Not Charging'), priceLabel: 'Standard', price: 900 }] },
    },
  });
  await prisma.jobStatusHistory.createMany({ data: [
    { jobId: job3.id, fromStatus: null, toStatus: 'RECEIVED', changedById: ccoId, changedAt: d('2026-10-13T10:30:00Z') },
    { jobId: job3.id, fromStatus: 'RECEIVED', toStatus: 'ASSIGNED', engineerId: eng2, changedById: ccoId, changedAt: d('2026-10-13T11:00:00Z') },
    { jobId: job3.id, fromStatus: 'ASSIGNED', toStatus: 'SPARE_PENDING', engineerId: eng2, changedById: eng2, changedAt: d('2026-10-13T12:30:00Z') },
  ] });
  await prisma.jobAssignment.create({ data: { jobId: job3.id, engineerId: eng2, assignedById: ccoId, assignedAt: d('2026-10-13T11:00:00Z') } });
  await prisma.jobPart.create({ data: { jobId: job3.id, partId: part('330'), quantity: 1, unitPrice: 600, status: 'NOT_AVAILABLE', note: 'Out of stock, awaiting transfer', requestedById: eng2, requestedAt: d('2026-10-13T12:30:00Z') } });
  await prisma.callLog.create({ data: { jobId: job3.id, branchId, purpose: 'FOLLOW_UP', outcome: 'CALL_LATER', note: 'Part arriving in 2 days', nextFollowUpAt: d('2026-10-18T10:00:00Z'), createdById: ccoId, createdAt: d('2026-10-14T10:00:00Z') } });

  // JOB 4 — sent to L4 (main office) for advanced repair
  const job4 = await prisma.job.create({
    data: {
      jobNumber: 'SC01-2610-0004', branchId, currentBranchId: mainOffice.id, location: 'TO_L4',
      customerId: cust('+919812345670'), brandId: brand('Apple'), deviceModelId: model('iPhone 13'),
      imei: '350000000000044', color: 'Midnight', customerComplaint: 'Dead after water damage', warranty: 'OUT_OF_WARRANTY',
      accessories: ['SIM Tray'], status: 'IN_REPAIR', assignedEngineerId: eng1, assignedAt: d('2026-10-15T11:00:00Z'),
      diagnosisNotes: 'Water damage, needs board-level repair at L4', diagnosedAt: d('2026-10-15T12:00:00Z'),
      inwardById: ccoId, createdById: ccoId, createdAt: d('2026-10-15T10:30:00Z'),
      faults: { create: [{ faultId: fault('Water Damaged') }] },
    },
  });
  await prisma.jobStatusHistory.createMany({ data: [
    { jobId: job4.id, fromStatus: null, toStatus: 'RECEIVED', changedById: ccoId, changedAt: d('2026-10-15T10:30:00Z') },
    { jobId: job4.id, fromStatus: 'RECEIVED', toStatus: 'ASSIGNED', engineerId: eng1, changedById: ccoId, changedAt: d('2026-10-15T11:00:00Z') },
    { jobId: job4.id, fromStatus: 'ASSIGNED', toStatus: 'IN_REPAIR', engineerId: eng1, changedById: eng1, changedAt: d('2026-10-15T12:00:00Z') },
  ] });
  await prisma.jobAssignment.create({ data: { jobId: job4.id, engineerId: eng1, assignedById: ccoId, assignedAt: d('2026-10-15T11:00:00Z') } });
  await prisma.jobMovement.create({ data: { jobId: job4.id, direction: 'TO_L4', fromBranchId: branchId, toBranchId: mainOffice.id, reason: 'Board-level water damage repair', sentById: ccoId, sentAt: d('2026-10-15T14:00:00Z') } });
  await prisma.jobPhoto.create({ data: { jobId: job4.id, kind: 'RWR', storageKey: 'seed/' + randomUUID() + '.jpg', mimeType: 'image/jpeg', sizeBytes: 150000, uploadedById: eng1 } });

  // JOB 5 — second delivered job (so invoices/final payments have multiple rows)
  const job5 = await prisma.job.create({
    data: {
      jobNumber: 'SC01-2610-0005', branchId, currentBranchId: branchId,
      customerId: cust('+919812345680'), brandId: brand('Samsung'), deviceModelId: model('Galaxy A52'),
      imei: '350000000000055', color: 'Awesome White', customerComplaint: 'Touch not responding', warranty: 'OUT_OF_WARRANTY',
      accessories: ['Back Cover'], estimatedAmount: 1800, quotedAmount: 1800, approvedAmount: 1800, approvedAt: d('2026-10-10T10:00:00Z'), approvedById: ccoId,
      status: 'DELIVERED', assignedEngineerId: eng2, assignedAt: d('2026-10-10T11:00:00Z'),
      diagnosisNotes: 'Digitizer fault', diagnosedAt: d('2026-10-10T12:00:00Z'), repairRemark: 'Replaced touch panel', repairedAt: d('2026-10-10T15:00:00Z'),
      testingRemark: 'OK', testingAt: d('2026-10-10T16:00:00Z'), readyAt: d('2026-10-10T16:30:00Z'),
      deliveredAt: d('2026-10-11T11:00:00Z'), deliveredById: ccoId, deliveredTo: 'Priya Nair',
      inwardById: ccoId, createdById: ccoId, createdAt: d('2026-10-10T10:30:00Z'),
      faults: { create: [{ faultId: fault('Touch Not Working'), priceLabel: 'Copy', price: 1800 }] },
      estimateLines: { create: [{ faultId: fault('Touch Not Working'), priceLabel: 'Copy', description: 'Touch panel', amount: 1800, sortOrder: 0 }] },
    },
  });
  await prisma.jobStatusHistory.createMany({ data: [
    { jobId: job5.id, fromStatus: null, toStatus: 'RECEIVED', changedById: ccoId, changedAt: d('2026-10-10T10:30:00Z') },
    { jobId: job5.id, fromStatus: 'RECEIVED', toStatus: 'ASSIGNED', engineerId: eng2, changedById: ccoId, changedAt: d('2026-10-10T11:00:00Z') },
    { jobId: job5.id, fromStatus: 'ASSIGNED', toStatus: 'REPAIRED', engineerId: eng2, changedById: eng2, changedAt: d('2026-10-10T15:00:00Z') },
    { jobId: job5.id, fromStatus: 'REPAIRED', toStatus: 'READY_FOR_DELIVERY', engineerId: eng2, changedById: eng2, changedAt: d('2026-10-10T16:30:00Z') },
    { jobId: job5.id, fromStatus: 'READY_FOR_DELIVERY', toStatus: 'DELIVERED', changedById: ccoId, changedAt: d('2026-10-11T11:00:00Z') },
  ] });
  await prisma.jobAssignment.create({ data: { jobId: job5.id, engineerId: eng2, assignedById: ccoId, assignedAt: d('2026-10-10T11:00:00Z'), endedAt: d('2026-10-11T11:00:00Z'), endReason: 'CLOSED' } });
  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-SC01-2610-0002', jobId: job5.id, branchId, subtotal: 1800, discount: 0, total: 1800, createdById: ccoId, createdAt: d('2026-10-11T11:00:00Z'),
      lines: { create: [{ description: 'Touch panel (Copy)', amount: 1800, sortOrder: 0 }] },
    },
  });
  await prisma.payment.create({ data: { jobId: job5.id, branchId, invoiceId: inv2.id, kind: 'FINAL', mode: 'UPI', amount: 1800, reference: 'UPI-FIN-005', receivedById: ccoId, createdAt: d('2026-10-11T11:00:00Z') } });
  await prisma.callLog.create({ data: { jobId: job5.id, branchId, purpose: 'READY_PICKUP', outcome: 'WILL_COLLECT', createdById: ccoId, createdAt: d('2026-10-10T17:00:00Z') } });

  // Second (accepted) engineer transfer + a refund payment to vary payment kinds
  await prisma.jobTransfer.create({ data: { jobId: job1.id, fromEngineerId: eng2, toEngineerId: eng1, reason: 'Original engineer resumed', status: 'ACCEPTED', responseNote: 'Accepted', heldSince: d('2026-10-01T11:00:00Z'), createdAt: d('2026-10-01T14:00:00Z'), respondedAt: d('2026-10-01T14:30:00Z') } });
  await prisma.payment.create({ data: { jobId: job1.id, branchId, kind: 'REFUND', mode: 'CASH', amount: 150, reference: 'Goodwill adjustment', receivedById: ccoId, createdAt: d('2026-10-03T10:05:00Z') } });

  // Return movement for job4 (TO_BRANCH) so movements have multiple rows
  await prisma.jobMovement.create({ data: { jobId: job4.id, direction: 'TO_BRANCH', fromBranchId: mainOffice.id, toBranchId: branchId, reason: 'Repaired at L4, returning', sentById: mgrId, sentAt: d('2026-10-16T09:00:00Z') } });

  // ── Stock transfers between branches (multiple rows, different statuses) ──
  await prisma.stockTransfer.create({ data: { partId: part('330'), fromBranchId: mainOffice.id, toBranchId: branchId, quantity: 2, status: 'SENT', note: 'Charging ports for pending jobs', sentById: storeId, sentAt: d('2026-10-15T16:00:00Z') } });
  await prisma.stockTransfer.create({ data: { partId: part('105'), fromBranchId: mainOffice.id, toBranchId: branchId, quantity: 1, status: 'RECEIVED', note: 'Display panel', sentById: storeId, sentAt: d('2026-10-12T10:00:00Z'), receivedById: storeId, receivedAt: d('2026-10-12T15:00:00Z') } });
  await prisma.stockMovement.createMany({ data: [
    { partId: part('330'), branchId: mainOffice.id, type: 'TRANSFER_OUT', quantity: -2, balanceAfter: 0, note: 'Transfer to SC01', createdById: storeId, createdAt: d('2026-10-15T16:00:00Z') },
    { partId: part('105'), branchId, type: 'RECEIPT', quantity: 5, balanceAfter: 5, unitCost: 2200, reference: 'PO-2026-001', note: 'Opening stock', createdById: storeId, createdAt: d('2026-10-01T09:00:00Z') },
  ] });

  // ── Expenses ─────────────────────────────────────────────────────────────
  await prisma.expense.createMany({ data: [
    { branchId, category: 'Courier', description: 'Sending phone to L4', amount: 120, mode: 'CASH', expenseDate: '2026-10-15', createdById: acctId },
    { branchId, category: 'Office', description: 'Tea & snacks', amount: 80, mode: 'CASH', expenseDate: '2026-10-15', createdById: acctId },
    { branchId, category: 'Tools', description: 'Screwdriver set (voided — wrong entry)', amount: 450, mode: 'UPI', expenseDate: '2026-10-14', createdById: acctId, voidedAt: d('2026-10-14T18:00:00Z'), voidedById: mgrId, voidReason: 'Duplicate entry' },
  ] });

  // ── Audit logs ───────────────────────────────────────────────────────────
  await prisma.auditLog.createMany({ data: [
    { actorId: user('superadmin'), action: 'seed.marker', entityType: 'system', entityId: 'seed-all', branchId: null, metadata: { note: 'Comprehensive demo seed' }, ip: '127.0.0.1' },
    { actorId: ccoId, action: 'job.created', entityType: 'job', entityId: job1.id, branchId, metadata: { jobNumber: job1.jobNumber } },
    { actorId: ccoId, action: 'job.delivered', entityType: 'job', entityId: job1.id, branchId, metadata: { total: 3500 } },
  ] });

  console.log('Transactional data seeded (jobs ' + job1.jobNumber + '..' + job5.jobNumber + ').');
  await summary();
}

async function summary() {
  const counts: Record<string, number> = {
    states: await prisma.state.count(), cities: await prisma.city.count(), branches: await prisma.branch.count(),
    users: await prisma.user.count(), sessions: await prisma.session.count(), brands: await prisma.brand.count(),
    deviceModels: await prisma.deviceModel.count(), faultCategories: await prisma.faultCategory.count(), faults: await prisma.fault.count(),
    servicePrices: await prisma.servicePrice.count(), parts: await prisma.part.count(), partStocks: await prisma.partStock.count(),
    stockMovements: await prisma.stockMovement.count(), stockTransfers: await prisma.stockTransfer.count(), customers: await prisma.customer.count(),
    jobs: await prisma.job.count(), jobFaults: await prisma.jobFault.count(), jobEstimateLines: await prisma.jobEstimateLine.count(),
    jobParts: await prisma.jobPart.count(), jobPhotos: await prisma.jobPhoto.count(), jobTransfers: await prisma.jobTransfer.count(),
    jobMovements: await prisma.jobMovement.count(), jobStatusHistory: await prisma.jobStatusHistory.count(), jobAssignments: await prisma.jobAssignment.count(),
    jobCounters: await prisma.jobCounter.count(), payments: await prisma.payment.count(), invoices: await prisma.invoice.count(),
    invoiceLines: await prisma.invoiceLine.count(), callLogs: await prisma.callLog.count(), expenses: await prisma.expense.count(),
    auditLogs: await prisma.auditLog.count(), shopSettings: await prisma.shopSettings.count(),
  };
  console.log('\nRow counts:');
  for (const [k, v] of Object.entries(counts)) console.log('  ' + k.padEnd(18) + v);
  console.log('\nLogin password for all seeded users: ' + PASSWORD);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

import type { JobDto } from '@msm/shared';

/** Dummy job used by the "Test Print" button to preview the printed job sheet. */
export function makeTestJob(): JobDto {
  const now = new Date().toISOString();
  return {
    id: 'test', jobNumber: 'TEST-0000', status: 'RECEIVED' as JobDto['status'], createdAt: now,
    branch: { id: 'test', code: 'TST', name: 'Test Branch', address: null, phone: null },
    customer: { id: 'test', name: 'Test Customer', phone: '9876543210', city: 'Khamgaon', altPhone: '9123456780', email: null, address: 'Railway Station Road, Khamgaon' },
    jobType: 'MOBILE', accessoryName: null,
    brand: { id: 'test', name: 'Samsung' }, model: { id: 'test', name: 'Galaxy S24' },
    imei: '356938035643809', imei2: '356938035643817', serialNumber: 'R5CW12ABCDE', color: 'Black',
    faults: [{ id: 'test', name: 'Display broken', priceLabel: null, price: null }],
    estimatedAmount: 2500,
    payments: [{ id: 'test', kind: 'ADVANCE', mode: 'CASH' as JobDto['payments'][number]['mode'], amount: 500, reference: null, createdAt: now }],
    customerComplaint: 'Screen cracked after fall, touch not working', accessories: ['SIM Card'], accessoriesOther: null,
    conditionNotes: null, physicalConditionRemark: 'Scratches on back panel',
    createdBy: { id: 'test', name: 'Test User' }, assignedEngineer: { id: 'test', name: 'Test Engineer' }, assignedAt: now,
    diagnosisNotes: null, diagnosedAt: null, quotedAmount: null, approvedAmount: null, approvedAt: null, approvedBy: null, customerResponse: null,
    repairedAt: null, readyAt: null,
    currentBranch: { id: 'test', code: 'TST', name: 'Test Branch', type: 'SERVICE_CENTER' },
    retailer: null, inwardBy: { id: 'test', name: 'Test User' }, phoneDamaged: true, warranty: 'OUT_OF_WARRANTY' as JobDto['warranty'],
    devicePassword: '1234', repairRemark: null, testingRemark: null, testingAt: null, cancelledAt: null, cancelReason: null,
    totalAmount: 2500, paidAmount: 500, balance: 2000, statusHistory: [], assignments: [],
    location: 'BRANCH' as JobDto['location'], movements: [],
    deliveredAt: null, deliveredTo: null, deliveryNote: null, deliveredBy: null, invoice: null,
    sparePart: null, spareRequestedAt: null, rwrReason: null, rwrNote: null, rwrAt: null,
    warrantyPeriod: null, warrantyTerms: null, pendingTransfer: null, parts: [], estimateLines: [], photos: [],
  };
}

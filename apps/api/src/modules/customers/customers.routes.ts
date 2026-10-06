import { Router } from 'express';
import { customerLookupQuerySchema, ROLES, type CustomerDto } from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import { prisma } from '../../lib/prisma.ts';

export const customerRoutes = Router();

/** Find a returning customer by mobile number (to prefill the job sheet). Returns null if new. */
customerRoutes.get(
  '/lookup',
  authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO),
  validate({ query: customerLookupQuerySchema }),
  async (_req, res) => {
    const customer: CustomerDto | null = await prisma.customer.findUnique({
      where: { phone: res.locals.query.phone },
      select: { id: true, name: true, phone: true, city: true, altPhone: true, email: true, address: true },
    });
    res.json({ customer });
  },
);

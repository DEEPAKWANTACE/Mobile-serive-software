import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { callRecordsSchema } from '@msm/shared';
import { env } from './config/env.ts';
import { HttpError } from './lib/http-error.ts';
import { validate } from './middleware/validate.ts';
import { ingest as ingestCalls } from './modules/calling/call-verify.service.ts';
import { authenticate } from './middleware/authenticate.ts';
import { accountsRoutes } from './modules/accounts/accounts.routes.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { brandRoutes } from './modules/brands/brands.routes.ts';
import { branchRoutes } from './modules/branches/branches.routes.ts';
import { callingRoutes } from './modules/calling/calling.routes.ts';
import { cityRoutes } from './modules/cities/cities.routes.ts';
import { customerRoutes } from './modules/customers/customers.routes.ts';
import { faultCategoryRoutes } from './modules/fault-categories/fault-categories.routes.ts';
import { faultRoutes } from './modules/faults/faults.routes.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { inventoryRoutes } from './modules/inventory/inventory.routes.ts';
import { jobRoutes } from './modules/jobs/jobs.routes.ts';
import { modelRoutes } from './modules/models/models.routes.ts';
import { partRoutes } from './modules/parts/parts.routes.ts';
import { reportRoutes } from './modules/reports/reports.routes.ts';
import { settingsRoutes } from './modules/settings/settings.routes.ts';
import { stateRoutes } from './modules/states/states.routes.ts';
import { userRoutes } from './modules/users/users.routes.ts';
import { reminderRoutes } from './modules/reminders/reminders.routes.ts';
import { managerRoutes } from './modules/manager/manager.routes.ts';

/** All feature modules are mounted here under /api/v1. */
export const apiRouter = Router();

// Public
apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.post('/calls/webhook', validate({ body: callRecordsSchema }), async (req, res) => {
  const key = env.CALL_WEBHOOK_KEY;
  if (!key) throw HttpError.badRequest('Call webhook is not enabled');
  const given = String(req.header('x-api-key') ?? '');
  if (given.length !== key.length || !timingSafeEqual(Buffer.from(given), Buffer.from(key))) throw HttpError.unauthorized();
  res.json(await ingestCalls(req.body, 'WEBHOOK', req.body.branchId ?? null));
});

// Everything below requires a signed-in user
apiRouter.use(authenticate);
apiRouter.use('/states', stateRoutes);
apiRouter.use('/cities', cityRoutes);
apiRouter.use('/branches', branchRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/brands', brandRoutes);
apiRouter.use('/models', modelRoutes);
apiRouter.use('/fault-categories', faultCategoryRoutes);
apiRouter.use('/faults', faultRoutes);
apiRouter.use('/customers', customerRoutes);
apiRouter.use('/jobs', jobRoutes);
apiRouter.use('/parts', partRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/accounts', accountsRoutes);
apiRouter.use('/calling', callingRoutes);
apiRouter.use('/reports', reportRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/reminders', reminderRoutes);
apiRouter.use('/manager', managerRoutes);

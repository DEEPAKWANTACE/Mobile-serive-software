import { Router } from 'express';
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

/** All feature modules are mounted here under /api/v1. */
export const apiRouter = Router();

// Public
apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);

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

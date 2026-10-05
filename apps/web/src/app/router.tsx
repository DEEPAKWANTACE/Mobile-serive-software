import { createBrowserRouter } from 'react-router';
import { ROLES } from '@msm/shared';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { JobDetailPage } from '@/features/jobs/JobDetailPage';
import { JobsPage } from '@/features/jobs/JobsPage';
import { NewJobPage } from '@/features/jobs/NewJobPage';
import { BrandsPage } from '@/features/catalog/BrandsPage';
import { FaultsPage } from '@/features/catalog/FaultsPage';
import { ModelsPage } from '@/features/catalog/ModelsPage';
import { PricingPage } from '@/features/catalog/PricingPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { BranchesPage } from '@/features/masters/BranchesPage';
import { CitiesPage } from '@/features/masters/CitiesPage';
import { StatesPage } from '@/features/masters/StatesPage';
import { StaffPage } from '@/features/staff/StaffPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          {
            path: 'jobs',
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ENGINEER]} />,
            children: [
              { index: true, element: <JobsPage /> },
              { path: ':id', element: <JobDetailPage /> },
              {
                element: <RequireAuth roles={[ROLES.CCO, ROLES.BRANCH_MANAGER]} />,
                children: [{ path: 'new', element: <NewJobPage /> }],
              },
            ],
          },
          {
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER]} />,
            children: [{ path: 'staff', element: <StaffPage /> }],
          },
          {
            path: 'masters',
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN]} />,
            children: [
              { path: 'states', element: <StatesPage /> },
              { path: 'cities', element: <CitiesPage /> },
              { path: 'branches', element: <BranchesPage /> },
            ],
          },
          {
            path: 'catalog',
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN]} />,
            children: [
              { path: 'brands', element: <BrandsPage /> },
              { path: 'models', element: <ModelsPage /> },
              { path: 'faults', element: <FaultsPage /> },
              { path: 'pricing', element: <PricingPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

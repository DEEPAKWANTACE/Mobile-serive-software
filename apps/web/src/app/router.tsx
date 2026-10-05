import { createBrowserRouter } from 'react-router';
import { ROLES } from '@msm/shared';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DayBookPage } from '@/features/accounts/DayBookPage';
import { CallingPage } from '@/features/calling/CallingPage';
import { L4TransfersPage } from '@/features/l4/L4TransfersPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { InvoicePage } from '@/features/billing/InvoicePage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { JobDetailPage } from '@/features/jobs/JobDetailPage';
import { JobsPage } from '@/features/jobs/JobsPage';
import { NewJobPage } from '@/features/jobs/NewJobPage';
import { BrandsPage } from '@/features/catalog/BrandsPage';
import { FaultCategoriesPage } from '@/features/catalog/FaultCategoriesPage';
import { FaultsPage } from '@/features/catalog/FaultsPage';
import { ModelsPage } from '@/features/catalog/ModelsPage';
import { PartsPage } from '@/features/catalog/PartsPage';
import { PricingPage } from '@/features/catalog/PricingPage';
import { PartRequestsPage } from '@/features/inventory/PartRequestsPage';
import { StockLedgerPage } from '@/features/inventory/StockLedgerPage';
import { StockPage } from '@/features/inventory/StockPage';
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
                element: <RequireAuth roles={[ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO]} />,
                children: [{ path: ':id/invoice', element: <InvoicePage /> }],
              },
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
              { path: 'fault-categories', element: <FaultCategoriesPage /> },
              { path: 'faults', element: <FaultsPage /> },
              { path: 'pricing', element: <PricingPage /> },
              { path: 'parts', element: <PartsPage /> },
            ],
          },
          {
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ACCOUNTS]} />,
            children: [
              { path: 'calling', element: <CallingPage /> },
              { path: 'l4', element: <L4TransfersPage /> },
              { path: 'accounts/day-book', element: <DayBookPage /> },
            ],
          },
          {
            element: <RequireAuth roles={[ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS]} />,
            children: [{ path: 'reports', element: <ReportsPage /> }],
          },
          {
            path: 'store',
            element: <RequireAuth roles={[ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN]} />,
            children: [
              { path: 'requests', element: <PartRequestsPage /> },
              { path: 'stock', element: <StockPage /> },
              { path: 'ledger', element: <StockLedgerPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

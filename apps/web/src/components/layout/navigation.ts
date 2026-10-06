import { ROLES, type Role } from '@msm/shared';

export type NavItem = {
  label: string;
  to: string;
  /** Omit to show to every authenticated role. */
  roles?: Role[];
};

export type NavSection = { title?: string; items: NavItem[] };

/** Sidebar entries. Each module adds its items here as it is built. */
export const NAV_SECTIONS: NavSection[] = [
  { items: [{ label: 'Dashboard', to: '/' }] },
  {
    title: 'Masters',
    items: [
      { label: 'Job Master', to: '/jobs', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] },
      { label: 'Entry Master', to: '/entries', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] },
      { label: 'User Master', to: '/staff', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER] },
      { label: 'Engineer Report', to: '/engineer-report', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS] },
    ],
  },
  {
    title: 'My Work',
    items: [{ label: 'My Jobs', to: '/jobs', roles: [ROLES.ENGINEER] }],
  },
  {
    title: 'Operations',
    items: [
      { label: 'New Job Sheet', to: '/jobs/new', roles: [ROLES.SUPER_ADMIN, ROLES.CCO, ROLES.BRANCH_MANAGER] },
      { label: 'L4 Transfers', to: '/l4', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] },
      { label: 'Customer Calling', to: '/calling', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ACCOUNTS] },
      { label: 'Day Book', to: '/accounts/day-book', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ACCOUNTS] },
      { label: 'Reports', to: '/reports', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS] },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Brands', to: '/catalog/brands', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Models', to: '/catalog/models', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Fault Categories', to: '/catalog/fault-categories', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Faults / Problems', to: '/catalog/faults', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Repair Pricing', to: '/catalog/pricing', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Spare Parts', to: '/catalog/parts', roles: [ROLES.SUPER_ADMIN] },
    ],
  },
  {
    title: 'Store',
    items: [
      { label: 'Part Requests', to: '/store/requests', roles: [ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN] },
      { label: 'Stock', to: '/store/stock', roles: [ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN] },
      { label: 'Stock Transfers', to: '/store/transfers', roles: [ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN] },
      { label: 'Stock Ledger', to: '/store/ledger', roles: [ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Shop Settings', to: '/settings/shop', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Branches', to: '/masters/branches', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Cities', to: '/masters/cities', roles: [ROLES.SUPER_ADMIN] },
      { label: 'States', to: '/masters/states', roles: [ROLES.SUPER_ADMIN] },
    ],
  },
];

export const navForRole = (role: Role) =>
  NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter(
    (s) => s.items.length > 0,
  );

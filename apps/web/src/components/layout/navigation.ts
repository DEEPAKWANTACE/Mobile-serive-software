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
    title: 'Jobs',
    items: [
      { label: 'New Job Sheet', to: '/jobs/new', roles: [ROLES.CCO, ROLES.BRANCH_MANAGER] },
      { label: 'Job Sheets', to: '/jobs', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] },
      { label: 'My Jobs', to: '/jobs', roles: [ROLES.ENGINEER] },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Brands', to: '/catalog/brands', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Models', to: '/catalog/models', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Faults / Problems', to: '/catalog/faults', roles: [ROLES.SUPER_ADMIN] },
      { label: 'Repair Pricing', to: '/catalog/pricing', roles: [ROLES.SUPER_ADMIN] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Staff', to: '/staff', roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER] },
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

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  CCO: 'CCO',
  ENGINEER: 'ENGINEER',
  STOREKEEPER: 'STOREKEEPER',
  ACCOUNTS: 'ACCOUNTS',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = Object.values(ROLES) as [Role, ...Role[]];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  BRANCH_MANAGER: 'Branch Manager',
  CCO: 'Customer Care Officer',
  ENGINEER: 'Engineer',
  STOREKEEPER: 'Storekeeper',
  ACCOUNTS: 'Accounts',
};

/** Roles that operate across all branches. Every other role is bound to a single branch. */
export const GLOBAL_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN];

export const isGlobalRole = (role: Role) => GLOBAL_ROLES.includes(role);

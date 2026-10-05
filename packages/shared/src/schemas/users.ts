import { z } from 'zod';
import { ROLE_VALUES, ROLES, type Role } from '../roles.js';
import { listQuerySchema, optionalText } from './common.js';
import { isValidAadhaar } from './aadhaar.js';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

const userFields = {
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._]{3,30}$/, '3–30 characters: letters, digits, dot or underscore'),
  phone: optionalText(10).refine((v) => !v || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
  email: optionalText(150).refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
  address: optionalText(300),
  aadhaarNumber: optionalText(14)
    .transform((v) => v?.replace(/\s/g, '') || null)
    .refine((v) => !v || isValidAadhaar(v), 'Enter a valid 12-digit Aadhaar number'),
  role: z.enum(ROLE_VALUES, 'Select a role'),
  /** Required for every role except Super Admin. */
  branchId: z.uuid('Select a branch').nullish(),
};

const branchRequired = (v: { role?: Role; branchId?: string | null }) =>
  v.role === undefined || v.role === ROLES.SUPER_ADMIN || !!v.branchId;
const branchRule = { message: 'Select a branch', path: ['branchId'] };

export const userCreateSchema = z.object({ ...userFields, password }).refine(branchRequired, branchRule);

/** Edit form (web): same fields as create, minus password. */
export const userEditFormSchema = z.object(userFields).refine(branchRequired, branchRule);

// Branch-required rule is checked in the API against the stored user, since a PATCH may omit fields.
export const userUpdateSchema = z.object({ ...userFields, isActive: z.boolean() }).partial();

export const resetPasswordSchema = z.object({ password });

export const userListQuerySchema = listQuerySchema.extend({
  branchId: z.uuid().optional(),
  role: z.enum(ROLE_VALUES).optional(),
});

export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
export type UserEditFormInput = z.input<typeof userEditFormSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export type UserDto = {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: Role;
  address: string | null;
  /** Full number for managers who can edit this user; otherwise masked (XXXX XXXX 1234). */
  aadhaarNumber: string | null;
  hasAadhaarPhoto: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  branch: { id: string; code: string; name: string } | null;
};

/** Roles a Branch Manager may create/manage inside their own branch. */
export const BRANCH_STAFF_ROLES: readonly Role[] = [ROLES.CCO, ROLES.ENGINEER, ROLES.STOREKEEPER, ROLES.ACCOUNTS];

// Parsed (post-validation) shapes, used by the API services.
export type UserCreateData = z.output<typeof userCreateSchema>;
export type UserUpdateData = z.output<typeof userUpdateSchema>;
export type UserListQuery = z.output<typeof userListQuerySchema>;

import { z } from 'zod';
import { listQuerySchema, optionalText } from './common.js';

export const BRANCH_TYPES = ['SERVICE_CENTER', 'MAIN_OFFICE'] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];
export const BRANCH_TYPE_LABELS: Record<BranchType, string> = {
  SERVICE_CENTER: 'Service Center',
  MAIN_OFFICE: 'Main Office (L4)',
};

const name = z.string().trim().min(2, 'Enter at least 2 characters').max(100);

// ─── States ─────────────────────────────────────────────────────────────────

export const stateCreateSchema = z.object({
  name,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Code must be 2–4 letters (e.g. MH)'),
});
export const stateUpdateSchema = stateCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export type StateCreateInput = z.input<typeof stateCreateSchema>;
export type StateUpdateInput = z.input<typeof stateUpdateSchema>;

export type StateDto = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  cityCount: number;
};

// ─── Cities ─────────────────────────────────────────────────────────────────

export const cityCreateSchema = z.object({
  stateId: z.uuid('Select a state'),
  name,
});
export const cityUpdateSchema = cityCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const cityListQuerySchema = listQuerySchema.extend({ stateId: z.uuid().optional() });
export type CityCreateInput = z.input<typeof cityCreateSchema>;
export type CityUpdateInput = z.input<typeof cityUpdateSchema>;

export type CityDto = {
  id: string;
  name: string;
  isActive: boolean;
  state: { id: string; name: string; code: string };
  branchCount: number;
};

// ─── Branches ───────────────────────────────────────────────────────────────

export const branchCreateSchema = z.object({
  cityId: z.uuid('Select a city'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Code must be 2–10 letters/digits (used in job numbers)'),
  name,
  type: z.enum(BRANCH_TYPES).default('SERVICE_CENTER'),
  address: optionalText(500),
  phone: optionalText(20).refine((v) => !v || /^[0-9+\-\s]{7,20}$/.test(v), 'Invalid phone number'),
});
export const branchUpdateSchema = branchCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const branchListQuerySchema = listQuerySchema.extend({
  stateId: z.uuid().optional(),
  cityId: z.uuid().optional(),
  type: z.enum(BRANCH_TYPES).optional(),
});
export type BranchCreateInput = z.input<typeof branchCreateSchema>;
export type BranchUpdateInput = z.input<typeof branchUpdateSchema>;

export type BranchDto = {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  city: { id: string; name: string; state: { id: string; name: string; code: string } };
  userCount: number;
};

// Parsed (post-validation) shapes, used by the API services.
export type StateCreateData = z.output<typeof stateCreateSchema>;
export type StateUpdateData = z.output<typeof stateUpdateSchema>;
export type CityCreateData = z.output<typeof cityCreateSchema>;
export type CityUpdateData = z.output<typeof cityUpdateSchema>;
export type CityListQuery = z.output<typeof cityListQuerySchema>;
export type BranchCreateData = z.output<typeof branchCreateSchema>;
export type BranchUpdateData = z.output<typeof branchUpdateSchema>;
export type BranchListQuery = z.output<typeof branchListQuerySchema>;

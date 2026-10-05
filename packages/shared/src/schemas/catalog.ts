import { z } from 'zod';
import { listQuerySchema, optionalText } from './common.js';

const name = z.string().trim().min(1, 'Name is required').max(100);

// ─── Brands ─────────────────────────────────────────────────────────────────

export const brandCreateSchema = z.object({ name });
export const brandUpdateSchema = brandCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export type BrandCreateInput = z.input<typeof brandCreateSchema>;
export type BrandCreateData = z.output<typeof brandCreateSchema>;
export type BrandUpdateData = z.output<typeof brandUpdateSchema>;

export type BrandDto = { id: string; name: string; isActive: boolean; modelCount: number };

// ─── Models ─────────────────────────────────────────────────────────────────

export const modelCreateSchema = z.object({ brandId: z.uuid('Select a brand'), name });
export const modelUpdateSchema = modelCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const modelListQuerySchema = listQuerySchema.extend({ brandId: z.uuid().optional() });
export type ModelCreateInput = z.input<typeof modelCreateSchema>;
export type ModelCreateData = z.output<typeof modelCreateSchema>;
export type ModelUpdateData = z.output<typeof modelUpdateSchema>;
export type ModelListQuery = z.output<typeof modelListQuerySchema>;

export type ModelDto = {
  id: string;
  name: string;
  isActive: boolean;
  brand: { id: string; name: string };
  /** Number of faults with a price set for this model. */
  priceCount: number;
};

// ─── Fault categories ───────────────────────────────────────────────────────

export const faultCategoryCreateSchema = z.object({
  name,
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export const faultCategoryUpdateSchema = faultCategoryCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export type FaultCategoryCreateInput = z.input<typeof faultCategoryCreateSchema>;
export type FaultCategoryCreateData = z.output<typeof faultCategoryCreateSchema>;
export type FaultCategoryUpdateData = z.output<typeof faultCategoryUpdateSchema>;

export type FaultCategoryDto = { id: string; name: string; sortOrder: number; isActive: boolean; faultCount: number };

// ─── Faults / problems ──────────────────────────────────────────────────────

export const faultCreateSchema = z.object({
  categoryId: z.uuid('Select a category'),
  name,
  description: optionalText(300),
  requiresIdProof: z.boolean().default(false),
});
export const faultUpdateSchema = faultCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const faultListQuerySchema = listQuerySchema.extend({ categoryId: z.uuid().optional() });
export type FaultCreateInput = z.input<typeof faultCreateSchema>;
export type FaultCreateData = z.output<typeof faultCreateSchema>;
export type FaultUpdateData = z.output<typeof faultUpdateSchema>;
export type FaultListQuery = z.output<typeof faultListQuerySchema>;

export type FaultDto = {
  id: string;
  name: string;
  description: string | null;
  requiresIdProof: boolean;
  isActive: boolean;
  category: { id: string; name: string } | null;
};

// ─── Service pricing (per model + fault) ────────────────────────────────────

export const priceAmount = z.coerce
  .number('Enter a valid amount')
  .min(0, 'Price cannot be negative')
  .max(10_000_000, 'Price is too large')
  .multipleOf(0.01, 'Max 2 decimal places');

export const priceOptionSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(40),
  price: priceAmount,
});

/**
 * Replace the price options of the listed faults for one model (e.g. Screen: Copy 1000 / OG 2000 / Original 3000).
 * An empty `options` array removes all prices for that fault; faults not listed are untouched.
 */
export const modelPricesUpdateSchema = z.object({
  prices: z
    .array(
      z.object({
        faultId: z.uuid(),
        options: z
          .array(priceOptionSchema)
          .max(10)
          .refine(
            (opts) => new Set(opts.map((o) => o.label.toLowerCase())).size === opts.length,
            'Option labels must be unique',
          ),
      }),
    )
    .max(1000)
    .refine((rows) => new Set(rows.map((r) => r.faultId)).size === rows.length, 'Duplicate fault in price list'),
});
export type ModelPricesUpdateData = z.output<typeof modelPricesUpdateSchema>;

/** One price option of a model + fault. */
export type ModelPriceDto = { id: string; faultId: string; label: string; price: number };

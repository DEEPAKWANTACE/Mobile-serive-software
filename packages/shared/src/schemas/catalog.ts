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

// ─── Faults / problems ──────────────────────────────────────────────────────

export const faultCreateSchema = z.object({ name, description: optionalText(300) });
export const faultUpdateSchema = faultCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export type FaultCreateInput = z.input<typeof faultCreateSchema>;
export type FaultCreateData = z.output<typeof faultCreateSchema>;
export type FaultUpdateData = z.output<typeof faultUpdateSchema>;

export type FaultDto = { id: string; name: string; description: string | null; isActive: boolean };

// ─── Service pricing (per model + fault) ────────────────────────────────────

export const priceAmount = z.coerce
  .number('Enter a valid amount')
  .min(0, 'Price cannot be negative')
  .max(10_000_000, 'Price is too large')
  .multipleOf(0.01, 'Max 2 decimal places');

/** Replace a model's price list. `price: null` removes that fault's price. */
export const modelPricesUpdateSchema = z.object({
  prices: z
    .array(z.object({ faultId: z.uuid(), price: priceAmount.nullable() }))
    .max(1000)
    .refine((rows) => new Set(rows.map((r) => r.faultId)).size === rows.length, 'Duplicate fault in price list'),
});
export type ModelPricesUpdateData = z.output<typeof modelPricesUpdateSchema>;

export type ModelPriceDto = { faultId: string; price: number };

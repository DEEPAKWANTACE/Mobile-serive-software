import { z } from 'zod';

/** Optional free-text field: trims, and turns "" into null so a form can clear it. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

/** Query-string boolean: "true" / "false" → boolean, anything else → undefined. */
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: queryBoolean,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const idParamSchema = z.object({ id: z.uuid() });

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

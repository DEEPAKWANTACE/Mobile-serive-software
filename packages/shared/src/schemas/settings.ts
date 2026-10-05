import { z } from 'zod';
import { optionalText } from './common.js';

/** 15-character GSTIN: 2-digit state code, PAN, entity no., 'Z', checksum character. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const shopSettingsSchema = z.object({
  shopName: z.string().trim().min(2, 'Enter the shop name').max(100),
  legalName: optionalText(150),
  gstin: optionalText(15)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => !v || GSTIN_PATTERN.test(v), 'Enter a valid 15-character GSTIN'),
  address: optionalText(300),
  phone: optionalText(30),
  email: optionalText(150).refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
  invoiceTerms: optionalText(1000),
});
export type ShopSettingsInput = z.input<typeof shopSettingsSchema>;
export type ShopSettingsData = z.output<typeof shopSettingsSchema>;

export type ShopSettingsDto = {
  shopName: string;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoiceTerms: string | null;
  hasLogo: boolean;
  /** Changes whenever the logo is replaced (cache-busting). */
  logoVersion: string | null;
};

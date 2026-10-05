import { z } from 'zod';
import { ROLE_VALUES } from '../roles.js';

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  role: z.enum(ROLE_VALUES),
  branch: z
    .object({ id: z.string(), code: z.string(), name: z.string() })
    .nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

import type { Request } from 'express';
import type { AccessTokenPayload } from './tokens.ts';

/** Who is acting and from where — passed from controllers into services for authorisation + audit. */
export type Actor = AccessTokenPayload & { ip?: string };

export const actorOf = (req: Request): Actor => ({ ...req.auth!, ip: req.ip });

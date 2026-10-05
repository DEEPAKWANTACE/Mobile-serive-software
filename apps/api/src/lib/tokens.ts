import { createHash, randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@msm/shared';
import { env } from '../config/env.ts';

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  branchId: string | null;
};

const ISSUER = 'msm-api';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('Invalid token payload');
  return { sub: decoded.sub as string, role: decoded.role, branchId: decoded.branchId ?? null };
}

/** Opaque refresh token; only its SHA-256 hash is stored in the database. */
export const generateRefreshToken = () => randomBytes(48).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

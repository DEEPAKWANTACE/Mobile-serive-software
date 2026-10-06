import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.ts';

/**
 * Symmetric encryption for small secrets stored in the database (e.g. a phone's unlock code).
 * AES-256-GCM; output "v1:<iv>:<tag>:<ciphertext>" (base64url). Key: DATA_ENCRYPTION_KEY, else derived from the JWT secret.
 */
const key = createHash('sha256')
  .update(env.DATA_ENCRYPTION_KEY ?? `msm-data-key:${env.JWT_ACCESS_SECRET}`)
  .digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':');
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [v, iv, tag, data] = stored.split(':');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

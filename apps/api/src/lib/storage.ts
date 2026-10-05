import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.ts';

/**
 * Private file storage. Files are never publicly reachable; they are streamed through
 * authorised API routes. Only a local-disk driver exists today — an S3-compatible driver
 * can implement the same interface for production.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const root = path.resolve(env.UPLOAD_DIR);

function resolveKey(key: string) {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export const storage: Storage = {
  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' });
  },
  async get(key) {
    const full = resolveKey(key);
    await stat(full); // throws ENOENT if missing
    return createReadStream(full);
  },
  async delete(key) {
    await rm(resolveKey(key), { force: true });
  },
};

import type { AccessTokenPayload } from '../lib/tokens.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      auth?: AccessTokenPayload;
    }
  }
}

export {};

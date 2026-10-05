import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.ts';
import { verifyAccessToken } from '../lib/tokens.ts';

/** Requires a valid Bearer access token and attaches its claims to `req.auth`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw HttpError.unauthorized();

  try {
    req.auth = verifyAccessToken(header.slice(7));
  } catch {
    throw new HttpError(401, 'Session expired or invalid', 'TOKEN_INVALID');
  }
  next();
};

import type { RequestHandler } from 'express';
import type { Role } from '@msm/shared';
import { HttpError } from '../lib/http-error.ts';

/** Restricts a route to the given roles. Must run after `authenticate`. */
export const authorize =
  (...allowed: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw HttpError.unauthorized();
    if (!allowed.includes(req.auth.role)) throw HttpError.forbidden();
    next();
  };

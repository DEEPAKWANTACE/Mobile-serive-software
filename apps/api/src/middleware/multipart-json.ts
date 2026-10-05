import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.ts';

/** For multipart requests that carry JSON in a text field: replaces req.body with the parsed field. */
export const multipartJson =
  (field = 'data'): RequestHandler =>
  (req, _res, next) => {
    const raw = req.body?.[field];
    if (typeof raw !== 'string') throw HttpError.badRequest(`Missing "${field}" field`);
    try {
      req.body = JSON.parse(raw);
    } catch {
      throw HttpError.badRequest(`"${field}" must be valid JSON`);
    }
    next();
  };

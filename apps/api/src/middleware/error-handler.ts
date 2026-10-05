import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError, z } from 'zod';
import { Prisma } from '../generated/prisma/client.ts';
import { HttpError } from '../lib/http-error.ts';
import { logger } from '../lib/logger.ts';

/** Unique index name → [form field, user-facing message]. Add entries as new unique constraints appear. */
const UNIQUE_CONSTRAINTS: Record<string, [string, string]> = {
  states_name_key: ['name', 'A state with this name already exists'],
  states_code_key: ['code', 'A state with this code already exists'],
  cities_state_id_name_key: ['name', 'This city already exists in the selected state'],
  branches_code_key: ['code', 'A branch with this code already exists'],
  users_username_key: ['username', 'This username is already taken'],
  users_phone_key: ['phone', 'This phone number is already registered'],
  users_email_key: ['email', 'This email is already registered'],
  brands_name_key: ['name', 'This brand already exists'],
  device_models_brand_id_name_key: ['name', 'This model already exists for the selected brand'],
  faults_name_key: ['name', 'This fault already exists'],
};

const constraintName = (err: Prisma.PrismaClientKnownRequestError): string | undefined =>
  (err.meta as { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined)
    ?.driverAdapterError?.cause?.constraint?.index;

export const notFoundHandler: RequestHandler = (req) => {
  throw HttpError.notFound(`Route ${req.method} ${req.path} not found`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: z.flattenError(err).fieldErrors },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const known = UNIQUE_CONSTRAINTS[constraintName(err) ?? ''];
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: known?.[1] ?? 'A record with these details already exists',
          details: known && { [known[0]]: [known[1]] },
        },
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A referenced record does not exist' } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
      return;
    }
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be under 8 MB' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many photos in one upload' : err.message;
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
    return;
  }

  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    return;
  }

  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { loginSchema } from '@msm/shared';
import { authenticate } from '../../middleware/authenticate.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './auth.controller.ts';

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' } },
});

export const authRoutes = Router();

authRoutes.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRoutes.post('/refresh', controller.refresh);
authRoutes.post('/logout', controller.logout);
authRoutes.get('/me', authenticate, controller.me);

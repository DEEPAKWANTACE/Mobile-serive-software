import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { apiRouter } from './routes.ts';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // correct client IPs behind a reverse proxy / load balancer
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

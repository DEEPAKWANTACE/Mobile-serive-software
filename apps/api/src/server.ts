import { env } from './config/env.ts';
import { createApp } from './app.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/prisma.ts';

const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

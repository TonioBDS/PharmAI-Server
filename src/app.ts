import Fastify, { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { blobRoutes } from './routes/blobs.js';
import { changeRoutes } from './routes/changes.js';
import { householdRoutes } from './routes/households.js';

export const VERSION = '0.3.0';

export function buildApp(config: Config, db: Db): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Jamais de jeton ni de contenu dans les journaux.
      redact: ['req.headers.authorization'],
    },
    trustProxy: true,
  });

  app.get('/health', async () => {
    await db.query('SELECT 1 AS ok');
    return { status: 'ok', version: VERSION, registration: config.allowRegistration };
  });

  app.register(householdRoutes, { db, config });
  app.register(changeRoutes, { db, config });
  app.register(blobRoutes, { db, config });

  return app;
}

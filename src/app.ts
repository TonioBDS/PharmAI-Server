import Fastify, { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { changeRoutes } from './routes/changes.js';
import { householdRoutes } from './routes/households.js';

export const VERSION = '0.1.0';

export function buildApp(config: Config, pool: Pool): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Jamais de jeton ni de contenu dans les journaux.
      redact: ['req.headers.authorization'],
    },
    trustProxy: true,
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', version: VERSION };
  });

  app.register(householdRoutes, { pool, config });
  app.register(changeRoutes, { pool, config });

  return app;
}

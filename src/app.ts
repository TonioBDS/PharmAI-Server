import Fastify, { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { blobRoutes } from './routes/blobs.js';
import { changeRoutes } from './routes/changes.js';
import { householdRoutes } from './routes/households.js';
import { purgeInactive } from './cleanup.js';

export const VERSION = '0.5.0';

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

  // Nettoyage des partages abandonnés, une fois par jour (désactivé par défaut)
  if (config.inactiveDays > 0) {
    const run = () =>
      purgeInactive(db, config.inactiveDays)
        .then((n) => n && app.log.info({ households: n }, 'foyers inactifs effacés'))
        .catch((err) => app.log.error(err, 'nettoyage des foyers inactifs'));
    let timer: NodeJS.Timeout | undefined;
    app.addHook('onReady', async () => {
      void run();
      timer = setInterval(run, 24 * 3600 * 1000);
      timer.unref();
    });
    app.addHook('onClose', async () => clearInterval(timer));
  }

  return app;
}

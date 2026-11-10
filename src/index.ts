import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

async function main() {
  const config = loadConfig();
  const db = await openDb(config.databaseUrl);
  const app = buildApp(config, db);

  const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

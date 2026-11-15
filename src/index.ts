import { buildApp } from './app.js';
import { readFileSync } from 'node:fs';
import { loadConfig, withOptions } from './config.js';
import { openDb } from './db.js';

async function main() {
  // OPTIONS_FILE : fichier d'options de Home Assistant (/data/options.json), défini par l'app HA
  const file = process.env.OPTIONS_FILE;
  const config = loadConfig(file ? withOptions(process.env, JSON.parse(readFileSync(file, 'utf8'))) : process.env);
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

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

/**
 * Le serveur ne stocke que des données chiffrées par les appareils (contenu des
 * armoires) et le strict nécessaire pour les router : foyers, appareils, jetons
 * hachés, invitations, demandes d'ajout. Il ne peut pas lire une armoire.
 *
 * Deux moteurs, même schéma logique :
 *  - SQLite (par défaut) : un seul fichier, idéal pour l'auto-hébergement ;
 *  - PostgreSQL (DATABASE_URL=postgres://…) : pour un service à plusieurs foyers.
 * Les requêtes sont écrites en SQL commun aux deux ($1, $2… ; dates en texte ISO passées par le code).
 *
 * Migrations : ajouter une entrée, ne jamais modifier une entrée publiée.
 */
const PG_MIGRATIONS: string[] = [
  `
  CREATE TABLE households (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE devices (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  );
  CREATE INDEX devices_household_idx ON devices(household_id);

  CREATE TABLE invites (
    code_hash TEXT PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  );

  CREATE TABLE changes (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL,
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (household_id, id)
  );
  CREATE INDEX changes_household_seq_idx ON changes(household_id, seq);
  `,
  // 2 : rôles (admin, membre, lecture seule) et demandes d'ajout validées par un administrateur
  `
  ALTER TABLE devices ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
  UPDATE devices d SET role = 'admin'
   WHERE d.id = (SELECT d2.id FROM devices d2 WHERE d2.household_id = d.household_id ORDER BY d2.created_at LIMIT 1);

  CREATE TABLE join_requests (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    role TEXT,
    sealed_key TEXT,
    device_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    decided_at TIMESTAMPTZ
  );
  CREATE INDEX join_requests_household_idx ON join_requests(household_id, status);
  `,
];

const SQLITE_MIGRATIONS: string[] = [
  `
  CREATE TABLE households (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX devices_household_idx ON devices(household_id);

  CREATE TABLE invites (
    code_hash TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (household_id, id)
  );
  CREATE INDEX changes_household_seq_idx ON changes(household_id, seq);

  CREATE TABLE join_requests (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    role TEXT,
    sealed_key TEXT,
    device_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX join_requests_household_idx ON join_requests(household_id, status);
  `,
];

export type Param = string | number | null;
export interface Result<T> {
  rows: T[];
  rowCount: number;
}
export type Query = <T = Record<string, unknown>>(sql: string, params?: Param[]) => Promise<Result<T>>;

export interface Db {
  dialect: 'postgres' | 'sqlite';
  query: Query;
  /** Exécute `fn` dans une transaction (tout ou rien). */
  tx<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Date lue en base → texte ISO (PostgreSQL renvoie des objets Date, SQLite du texte). */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// ---------- PostgreSQL ----------

async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const run =
    (client: pg.Pool | pg.PoolClient): Query =>
    async <T>(sql: string, params: Param[] = []) => {
      const r = await client.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    };

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    let version = rows[0]?.v ?? 0;
    while (version < PG_MIGRATIONS.length) {
      await client.query('BEGIN');
      try {
        await client.query(PG_MIGRATIONS[version]);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version + 1]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      version += 1;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }

  return {
    dialect: 'postgres',
    query: run(pool),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(run(c));
        await c.query('COMMIT');
        return out;
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

// ---------- SQLite ----------

async function openSqlite(path: string): Promise<Db> {
  // Import dynamique : le module n'est chargé que si SQLite est utilisé
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  let version = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  while (version < SQLITE_MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(SQLITE_MIGRATIONS[version]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version + 1, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    version += 1;
  }

  const direct: Query = async <T>(sql: string, params: Param[] = []) => {
    const stmt = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
    if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const rows = stmt.all(...params) as T[];
      return { rows, rowCount: rows.length };
    }
    const r = stmt.run(...params);
    return { rows: [], rowCount: Number(r.changes) };
  };

  // Une seule connexion : les requêtes passent une par une, pour qu'aucune ne se glisse dans la transaction d'une autre
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    dialect: 'sqlite',
    query: (sql, params) => exclusive(() => direct(sql, params)),
    tx: (fn) =>
      exclusive(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(direct);
          db.exec('COMMIT');
          return out;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }),
    async close() {
      db.close();
    },
  };
}

/** Ouvre la base (et applique les migrations) : `postgres://…`, `sqlite:/chemin/fichier.db` ou `sqlite::memory:`. */
export async function openDb(databaseUrl: string): Promise<Db> {
  if (/^postgres(ql)?:\/\//.test(databaseUrl)) return openPostgres(databaseUrl);
  if (databaseUrl.startsWith('sqlite:')) return openSqlite(databaseUrl.slice('sqlite:'.length));
  throw new Error('DATABASE_URL doit commencer par postgres:// ou sqlite:');
}

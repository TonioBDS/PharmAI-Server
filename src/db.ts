import pg from 'pg';

/**
 * Le serveur ne stocke que des données chiffrées par les appareils (contenu des
 * armoires) et le strict nécessaire pour les router : foyers, appareils, jetons
 * hachés, invitations. Il ne peut pas lire une armoire.
 *
 * Migrations : ajouter une entrée, ne jamais modifier une entrée publiée.
 */
const MIGRATIONS: string[] = [
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
];

export type Pool = pg.Pool;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    let version = rows[0]?.v ?? 0;
    while (version < MIGRATIONS.length) {
      await client.query('BEGIN');
      try {
        await client.query(MIGRATIONS[version]);
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
}

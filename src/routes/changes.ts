import type { FastifyInstance } from 'fastify';
import { requireDevice } from '../auth.js';
import type { Config } from '../config.js';
import { Db, iso } from '../db.js';

const MAX_BATCH = 500;
const BASE64 = '^[A-Za-z0-9+/_-]+={0,2}$';
const householdParams = { type: 'object', required: ['householdId'], properties: { householdId: { type: 'string', format: 'uuid' } } } as const;

/**
 * Journal des modifications chiffrées d'un foyer.
 *
 * Chaque appareil envoie des modifications déjà chiffrées (nonce + ciphertext)
 * avec un identifiant unique ; un renvoi du même identifiant est ignoré
 * (envoi idempotent après une coupure réseau). Les autres appareils lisent
 * le journal à partir de leur dernier curseur (seq). Un appareil en lecture
 * seule peut lire mais pas écrire.
 */
export async function changeRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const maxB64 = Math.ceil((config.maxChangeBytes * 4) / 3) + 4;

  app.post(
    '/v1/households/:householdId/changes',
    {
      bodyLimit: MAX_BATCH * maxB64 + 64 * 1024,
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['changes'],
          properties: {
            changes: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_BATCH,
              items: {
                type: 'object',
                required: ['id', 'nonce', 'ciphertext'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  nonce: { type: 'string', minLength: 8, maxLength: 64, pattern: BASE64 },
                  ciphertext: { type: 'string', minLength: 1, maxLength: maxB64, pattern: BASE64 },
                },
              },
            },
          },
        },
      },
      preHandler: requireDevice(db, 'admin', 'member'),
    },
    async (request) => {
      const { changes } = request.body as { changes: { id: string; nonce: string; ciphertext: string }[] };
      const { householdId, deviceId } = request.device!;
      const now = new Date().toISOString();
      return db.tx(async (query) => {
        let accepted = 0;
        for (const c of changes) {
          const r = await query(
            `INSERT INTO changes (id, household_id, device_id, nonce, ciphertext, created_at) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (household_id, id) DO NOTHING`,
            [c.id, householdId, deviceId, c.nonce, c.ciphertext, now],
          );
          accepted += r.rowCount;
        }
        const { rows } = await query<{ cursor: string | number | null }>('SELECT MAX(seq) AS cursor FROM changes WHERE household_id = $1', [householdId]);
        return { accepted, duplicates: changes.length - accepted, latestSeq: Number(rows[0]?.cursor ?? 0) };
      });
    },
  );

  app.get(
    '/v1/households/:householdId/changes',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_BATCH, default: MAX_BATCH },
          },
        },
      },
      preHandler: requireDevice(db),
    },
    async (request) => {
      const { since, limit } = request.query as { since: number; limit: number };
      const { rows } = await db.query<{ seq: string | number; id: string; device_id: string; nonce: string; ciphertext: string; created_at: unknown }>(
        `SELECT seq, id, device_id, nonce, ciphertext, created_at
           FROM changes WHERE household_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [request.device!.householdId, since, limit + 1],
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((r) => ({ seq: Number(r.seq), id: r.id, deviceId: r.device_id, nonce: r.nonce, ciphertext: r.ciphertext, createdAt: iso(r.created_at) }));
      return { changes: page, cursor: page.length ? page[page.length - 1].seq : since, hasMore };
    },
  );
}

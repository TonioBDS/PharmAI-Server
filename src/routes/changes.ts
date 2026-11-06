import type { FastifyInstance } from 'fastify';
import { requireDevice } from '../auth.js';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';

const MAX_BATCH = 500;
const BASE64 = '^[A-Za-z0-9+/_-]+={0,2}$';

/**
 * Journal des modifications chiffrées d'un foyer.
 *
 * Chaque appareil envoie des modifications déjà chiffrées (nonce + ciphertext)
 * avec un identifiant unique ; un renvoi du même identifiant est ignoré
 * (envoi idempotent après une coupure réseau). Les autres appareils lisent
 * le journal à partir de leur dernier curseur (seq).
 */
export async function changeRoutes(app: FastifyInstance, opts: { pool: Pool; config: Config }) {
  const { pool, config } = opts;
  const auth = requireDevice(pool);
  const maxB64 = Math.ceil((config.maxChangeBytes * 4) / 3) + 4;

  app.post(
    '/v1/households/:householdId/changes',
    {
      bodyLimit: MAX_BATCH * maxB64 + 64 * 1024,
      schema: {
        params: { type: 'object', required: ['householdId'], properties: { householdId: { type: 'string', format: 'uuid' } } },
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
      preHandler: auth,
    },
    async (request) => {
      const { changes } = request.body as { changes: { id: string; nonce: string; ciphertext: string }[] };
      const { householdId, deviceId } = request.device!;
      const ids = changes.map((c) => c.id);
      const nonces = changes.map((c) => c.nonce);
      const ciphertexts = changes.map((c) => c.ciphertext);
      const inserted = await pool.query<{ seq: string }>(
        `INSERT INTO changes (id, household_id, device_id, nonce, ciphertext)
         SELECT u.id, $1, $2, u.nonce, u.ciphertext
           FROM unnest($3::uuid[], $4::text[], $5::text[]) WITH ORDINALITY AS u(id, nonce, ciphertext, ord)
          ORDER BY u.ord
         ON CONFLICT (household_id, id) DO NOTHING
         RETURNING seq`,
        [householdId, deviceId, ids, nonces, ciphertexts],
      );
      const { rows } = await pool.query<{ cursor: string | null }>(
        'SELECT MAX(seq) AS cursor FROM changes WHERE household_id = $1',
        [householdId],
      );
      return { accepted: inserted.rowCount ?? 0, duplicates: changes.length - (inserted.rowCount ?? 0), latestSeq: Number(rows[0]?.cursor ?? 0) };
    },
  );

  app.get(
    '/v1/households/:householdId/changes',
    {
      schema: {
        params: { type: 'object', required: ['householdId'], properties: { householdId: { type: 'string', format: 'uuid' } } },
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_BATCH, default: MAX_BATCH },
          },
        },
      },
      preHandler: auth,
    },
    async (request) => {
      const { since, limit } = request.query as { since: number; limit: number };
      const { rows } = await pool.query<{ seq: string; id: string; deviceId: string; nonce: string; ciphertext: string; createdAt: Date }>(
        `SELECT seq, id, device_id AS "deviceId", nonce, ciphertext, created_at AS "createdAt"
           FROM changes WHERE household_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [request.device!.householdId, since, limit + 1],
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((r) => ({ ...r, seq: Number(r.seq) }));
      return { changes: page, cursor: page.length ? page[page.length - 1].seq : since, hasMore };
    },
  );
}

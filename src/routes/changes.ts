import type { FastifyInstance } from 'fastify';
import { canSee, requireDevice, SCOPE_PATTERN } from '../auth.js';
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
 *
 * Une modification peut porter une « portée » : l'empreinte opaque d'une personne
 * du foyer (prises, traitements, ordonnances). Un appareil à qui l'administrateur
 * n'a partagé que certaines personnes ne reçoit que les modifications communes et
 * celles de ces personnes ; il ne peut écrire que dans ces portées.
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
            // Époque de la clé du foyer utilisée pour chiffrer ce lot
            epoch: { type: 'integer', minimum: 1, default: 1 },
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
                  scope: { type: 'string', pattern: SCOPE_PATTERN },
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
    async (request, reply) => {
      const { changes, epoch } = request.body as { epoch: number; changes: { id: string; scope?: string; nonce: string; ciphertext: string }[] };
      const { householdId, deviceId } = request.device!;
      // Personne non partagée avec cet appareil : il ne peut rien écrire la concernant
      if (changes.some((c) => !canSee(request.device!, c.scope))) return reply.code(403).send({ error: 'forbidden_scope' });
      const now = new Date().toISOString();
      const result = await db.tx(async (query) => {
        // Clé renouvelée entre-temps : l'appareil doit d'abord récupérer la nouvelle
        const h = (await query<{ key_epoch: number | string }>('SELECT key_epoch FROM households WHERE id = $1', [householdId])).rows[0];
        if (Number(h?.key_epoch ?? 1) !== epoch) return null;
        let accepted = 0;
        for (const c of changes) {
          const r = await query(
            `INSERT INTO changes (id, household_id, device_id, nonce, ciphertext, created_at, epoch, scope) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (household_id, id) DO NOTHING`,
            [c.id, householdId, deviceId, c.nonce, c.ciphertext, now, epoch, c.scope ?? null],
          );
          accepted += r.rowCount;
        }
        const { rows } = await query<{ cursor: string | number | null }>('SELECT MAX(seq) AS cursor FROM changes WHERE household_id = $1', [householdId]);
        return { accepted, duplicates: changes.length - accepted, latestSeq: Number(rows[0]?.cursor ?? 0) };
      });
      if (!result) return reply.code(409).send({ error: 'stale_epoch' });
      return result;
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
            // Rattrapage après l'ajout de personnes partagées : seulement ces portées (« * » : toutes), jusqu'à `until`
            scopes: { type: 'string', pattern: '^(\\*|[a-f0-9]{32}(,[a-f0-9]{32}){0,199})$' },
            until: { type: 'integer', minimum: 0 },
          },
        },
      },
      preHandler: requireDevice(db),
    },
    async (request) => {
      const { since, limit, scopes, until } = request.query as { since: number; limit: number; scopes?: string; until?: number };
      const device = request.device!;
      const params: (string | number)[] = [device.householdId, since, limit + 1];
      const where: string[] = [];
      const inList = (list: string[]) => list.map((s) => `$${params.push(s)}`).join(', ');
      // Ce que l'appareil a le droit de voir : le commun et les personnes partagées
      if (device.scopes !== null) where.push(device.scopes.length ? `(scope IS NULL OR scope IN (${inList(device.scopes)}))` : 'scope IS NULL');
      if (scopes === '*') where.push('scope IS NOT NULL');
      else if (scopes) where.push(`scope IN (${inList(scopes.split(','))})`);
      if (until !== undefined) where.push(`seq <= $${params.push(until)}`);
      const { rows } = await db.query<{ seq: string | number; id: string; device_id: string; nonce: string; ciphertext: string; created_at: unknown; epoch: number | string }>(
        `SELECT seq, id, device_id, nonce, ciphertext, created_at, epoch
           FROM changes WHERE household_id = $1 AND seq > $2 ${where.map((w) => `AND ${w} `).join('')}ORDER BY seq LIMIT $3`,
        params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((r) => ({ seq: Number(r.seq), id: r.id, deviceId: r.device_id, nonce: r.nonce, ciphertext: r.ciphertext, epoch: Number(r.epoch), createdAt: iso(r.created_at) }));
      return { changes: page, cursor: page.length ? page[page.length - 1].seq : since, hasMore };
    },
  );
}

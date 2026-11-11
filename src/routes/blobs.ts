import type { FastifyInstance } from 'fastify';
import { canSee, requireDevice, SCOPE_PATTERN } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

const BASE64 = '^[A-Za-z0-9+/_-]+={0,2}$';
const householdParams = { type: 'object', required: ['householdId'], properties: { householdId: { type: 'string', format: 'uuid' } } } as const;
const blobParams = {
  type: 'object',
  required: ['householdId', 'blobId'],
  // Identifiant opaque calculé par les téléphones (empreinte) : il ne dit rien du fichier
  properties: { householdId: { type: 'string', format: 'uuid' }, blobId: { type: 'string', pattern: '^[a-f0-9]{32,64}$' } },
} as const;

/**
 * Fichiers chiffrés d'un foyer (photos des produits et des ordonnances).
 * Comme pour le journal, le serveur ne stocke que des blocs opaques : nom,
 * type et contenu du fichier sont chiffrés ou hachés par les téléphones.
 */
export async function blobRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const maxB64 = Math.ceil((config.maxBlobBytes * 4) / 3) + 64;

  app.get('/v1/households/:householdId/blobs', { schema: { params: householdParams }, preHandler: requireDevice(db) }, async (request) => {
    const { rows } = await db.query<{ id: string; scope: string | null }>('SELECT id, scope FROM blobs WHERE household_id = $1', [request.device!.householdId]);
    // Photos d'ordonnances d'une personne non partagée avec cet appareil : invisibles
    return { ids: rows.filter((r) => canSee(request.device!, r.scope)).map((r) => r.id) };
  });

  app.put(
    '/v1/households/:householdId/blobs/:blobId',
    {
      bodyLimit: maxB64 + 4096,
      schema: {
        params: blobParams,
        body: {
          type: 'object',
          required: ['nonce', 'ciphertext'],
          additionalProperties: false,
          properties: {
            epoch: { type: 'integer', minimum: 1, default: 1 },
            scope: { type: 'string', pattern: SCOPE_PATTERN },
            nonce: { type: 'string', minLength: 8, maxLength: 64, pattern: BASE64 },
            ciphertext: { type: 'string', minLength: 1, maxLength: maxB64, pattern: BASE64 },
          },
        },
      },
      preHandler: requireDevice(db, 'admin', 'member'),
    },
    async (request, reply) => {
      const { blobId } = request.params as { blobId: string };
      const { epoch, nonce, ciphertext, scope } = request.body as { epoch: number; nonce: string; ciphertext: string; scope?: string };
      const { householdId, deviceId } = request.device!;
      if (!canSee(request.device!, scope)) return reply.code(403).send({ error: 'forbidden_scope' });
      const h = (await db.query<{ key_epoch: number | string }>('SELECT key_epoch FROM households WHERE id = $1', [householdId])).rows[0];
      if (Number(h?.key_epoch ?? 1) !== epoch) return reply.code(409).send({ error: 'stale_epoch' });
      // Un fichier ne change jamais (nouvelle photo = nouvel identifiant) : un renvoi est ignoré
      await db.query(
        `INSERT INTO blobs (household_id, id, device_id, epoch, nonce, ciphertext, created_at, scope) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (household_id, id) DO NOTHING`,
        [householdId, blobId, deviceId, epoch, nonce, ciphertext, new Date().toISOString(), scope ?? null],
      );
      return reply.code(204).send();
    },
  );

  app.get('/v1/households/:householdId/blobs/:blobId', { schema: { params: blobParams }, preHandler: requireDevice(db) }, async (request, reply) => {
    const { blobId } = request.params as { blobId: string };
    const { rows } = await db.query<{ epoch: number | string; nonce: string; ciphertext: string; scope: string | null }>(
      'SELECT epoch, nonce, ciphertext, scope FROM blobs WHERE household_id = $1 AND id = $2',
      [request.device!.householdId, blobId],
    );
    if (!rows[0] || !canSee(request.device!, rows[0].scope)) return reply.code(404).send({ error: 'not_found' });
    return { epoch: Number(rows[0].epoch), nonce: rows[0].nonce, ciphertext: rows[0].ciphertext };
  });

  app.delete('/v1/households/:householdId/blobs/:blobId', { schema: { params: blobParams }, preHandler: requireDevice(db, 'admin', 'member') }, async (request, reply) => {
    const { blobId } = request.params as { blobId: string };
    await db.query('DELETE FROM blobs WHERE household_id = $1 AND id = $2', [request.device!.householdId, blobId]);
    return reply.code(204).send();
  });
}

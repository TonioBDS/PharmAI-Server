import type { FastifyInstance } from 'fastify';
import { hash, newInviteCode, newToken, randomUUID, requireDevice } from '../auth.js';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';

const deviceNameSchema = { type: 'string', minLength: 1, maxLength: 80 } as const;
const uuidSchema = { type: 'string', format: 'uuid' } as const;
const householdParams = {
  type: 'object',
  required: ['householdId'],
  properties: { householdId: uuidSchema },
} as const;

/**
 * Foyers, appareils et invitations.
 *
 * La clé de chiffrement du foyer ne passe jamais par ici : elle est transmise
 * d'appareil à appareil (QR code). Le code d'invitation donne seulement le
 * droit de se connecter au serveur pour ce foyer.
 */
export async function householdRoutes(app: FastifyInstance, opts: { pool: Pool; config: Config }) {
  const { pool, config } = opts;
  const auth = requireDevice(pool);

  async function createDevice(client: Pool | import('pg').PoolClient, householdId: string, name: string) {
    const deviceId = randomUUID();
    const token = newToken();
    await client.query('INSERT INTO devices (id, household_id, name, token_hash) VALUES ($1, $2, $3, $4)', [
      deviceId,
      householdId,
      name,
      hash(token),
    ]);
    return { householdId, deviceId, deviceToken: token };
  }

  app.post(
    '/v1/households',
    { schema: { body: { type: 'object', required: ['deviceName'], properties: { deviceName: deviceNameSchema } } } },
    async (request, reply) => {
      if (!config.allowRegistration) return reply.code(403).send({ error: 'registration_closed' });
      const { deviceName } = request.body as { deviceName: string };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const householdId = randomUUID();
        await client.query('INSERT INTO households (id) VALUES ($1)', [householdId]);
        const result = await createDevice(client, householdId, deviceName);
        await client.query('COMMIT');
        return reply.code(201).send(result);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/v1/households/:householdId/invites',
    { schema: { params: householdParams }, preHandler: auth },
    async (request, reply) => {
      const code = newInviteCode();
      const expiresAt = new Date(Date.now() + config.inviteTtlHours * 3_600_000);
      await pool.query('INSERT INTO invites (code_hash, household_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [
        hash(code),
        request.device!.householdId,
        request.device!.deviceId,
        expiresAt,
      ]);
      return reply.code(201).send({ inviteCode: code, expiresAt: expiresAt.toISOString() });
    },
  );

  app.post(
    '/v1/invites/accept',
    {
      schema: {
        body: {
          type: 'object',
          required: ['inviteCode', 'deviceName'],
          properties: { inviteCode: { type: 'string', minLength: 6, maxLength: 32 }, deviceName: deviceNameSchema },
        },
      },
    },
    async (request, reply) => {
      const { inviteCode, deviceName } = request.body as { inviteCode: string; deviceName: string };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ household_id: string }>(
          `UPDATE invites SET used_at = now()
            WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
            RETURNING household_id`,
          [hash(inviteCode.trim().toUpperCase())],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'invalid_invite' });
        }
        const result = await createDevice(client, rows[0].household_id, deviceName);
        await client.query('COMMIT');
        return reply.code(201).send(result);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.get('/v1/households/:householdId/devices', { schema: { params: householdParams }, preHandler: auth }, async (request) => {
    const { rows } = await pool.query(
      `SELECT id, name, created_at AS "createdAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt"
         FROM devices WHERE household_id = $1 ORDER BY created_at`,
      [request.device!.householdId],
    );
    return { devices: rows.map((d) => ({ ...d, current: d.id === request.device!.deviceId })) };
  });

  app.delete(
    '/v1/households/:householdId/devices/:deviceId',
    {
      schema: {
        params: { type: 'object', required: ['householdId', 'deviceId'], properties: { householdId: uuidSchema, deviceId: uuidSchema } },
      },
      preHandler: auth,
    },
    async (request, reply) => {
      const { deviceId } = request.params as { deviceId: string };
      const { rowCount } = await pool.query(
        'UPDATE devices SET revoked_at = now() WHERE id = $1 AND household_id = $2 AND revoked_at IS NULL',
        [deviceId, request.device!.householdId],
      );
      if (!rowCount) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );
}

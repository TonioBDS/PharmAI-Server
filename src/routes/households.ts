import type { FastifyInstance } from 'fastify';
import { bearer, hash, newInviteCode, newToken, parseScopes, randomUUID, rateLimiter, requireDevice, Role, ROLES, SCOPE_PATTERN } from '../auth.js';
import type { Config } from '../config.js';
import { Db, iso, Query } from '../db.js';

const deviceNameSchema = { type: 'string', minLength: 1, maxLength: 80 } as const;
const uuidSchema = { type: 'string', format: 'uuid' } as const;
const roleSchema = { type: 'string', enum: [...ROLES] } as const;
const sealedSchema = { type: 'string', minLength: 16, maxLength: 16384, pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const;
// Personnes partagées avec un appareil (empreintes opaques) ; null : tout le foyer, y compris les personnes ajoutées plus tard
const scopesSchema = { anyOf: [{ type: 'null' }, { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', pattern: SCOPE_PATTERN } }] } as const;
const base64Schema = { type: 'string', minLength: 16, maxLength: 512, pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const;
const householdParams = { type: 'object', required: ['householdId'], properties: { householdId: uuidSchema } } as const;
const deviceParams = { type: 'object', required: ['householdId', 'deviceId'], properties: { householdId: uuidSchema, deviceId: uuidSchema } } as const;
const requestParams = { type: 'object', required: ['householdId', 'requestId'], properties: { householdId: uuidSchema, requestId: uuidSchema } } as const;

/**
 * Foyers, appareils, invitations et demandes d'ajout.
 *
 * Ajouter un téléphone se fait en deux temps :
 *  1. un administrateur crée une invitation (QR code ou lien) ; le nouveau
 *     téléphone l'utilise pour déposer une demande avec sa clé publique ;
 *  2. un administrateur compare le code de vérification affiché sur les deux
 *     écrans, choisit un rôle et valide : son téléphone chiffre la clé du foyer
 *     pour la clé publique du nouveau (sealedKey), que le serveur ne fait que relayer.
 * La clé du foyer ne passe donc jamais en clair par le serveur, ni par le lien.
 */
export async function householdRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const anyDevice = requireDevice(db);
  const admin = requireDevice(db, 'admin');
  const limit = rateLimiter(config.publicRateLimit);
  const now = () => new Date().toISOString();

  const activeAdmins = async (query: Query, householdId: string) =>
    Number((await query<{ n: number | string }>("SELECT COUNT(*) AS n FROM devices WHERE household_id = $1 AND revoked_at IS NULL AND role = 'admin'", [householdId])).rows[0].n);
  const activeDevices = async (query: Query, householdId: string) =>
    Number((await query<{ n: number | string }>('SELECT COUNT(*) AS n FROM devices WHERE household_id = $1 AND revoked_at IS NULL', [householdId])).rows[0].n);

  // ---------- Foyer ----------

  app.post(
    '/v1/households',
    { schema: { body: { type: 'object', required: ['deviceName'], properties: { deviceName: deviceNameSchema } } }, preHandler: limit },
    async (request, reply) => {
      if (!config.allowRegistration) return reply.code(403).send({ error: 'registration_closed' });
      const { deviceName } = request.body as { deviceName: string };
      const householdId = randomUUID();
      const deviceId = randomUUID();
      const token = newToken();
      await db.tx(async (query) => {
        await query('INSERT INTO households (id, created_at) VALUES ($1, $2)', [householdId, now()]);
        await query("INSERT INTO devices (id, household_id, name, token_hash, role, created_at) VALUES ($1, $2, $3, $4, 'admin', $5)", [
          deviceId,
          householdId,
          deviceName,
          hash(token),
          now(),
        ]);
      });
      return reply.code(201).send({ householdId, deviceId, deviceToken: token, role: 'admin' });
    },
  );

  /** Arrêt du partage : efface du serveur le foyer, ses appareils et son journal chiffré. */
  app.delete('/v1/households/:householdId', { schema: { params: householdParams }, preHandler: admin }, async (request, reply) => {
    await db.query('DELETE FROM households WHERE id = $1', [request.device!.householdId]);
    return reply.code(204).send();
  });

  // ---------- Invitations et demandes d'ajout ----------

  app.post('/v1/households/:householdId/invites', { schema: { params: householdParams }, preHandler: admin }, async (request, reply) => {
    const code = newInviteCode();
    const expiresAt = new Date(Date.now() + config.inviteTtlHours * 3_600_000).toISOString();
    await db.query('INSERT INTO invites (code_hash, household_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [
      hash(code),
      request.device!.householdId,
      request.device!.deviceId,
      expiresAt,
    ]);
    return reply.code(201).send({ inviteCode: code, expiresAt });
  });

  app.post(
    '/v1/invites/join',
    {
      schema: {
        body: {
          type: 'object',
          required: ['inviteCode', 'deviceName', 'publicKey'],
          properties: { inviteCode: { type: 'string', minLength: 6, maxLength: 32 }, deviceName: deviceNameSchema, publicKey: base64Schema },
        },
      },
      preHandler: limit,
    },
    async (request, reply) => {
      const { inviteCode, deviceName, publicKey } = request.body as { inviteCode: string; deviceName: string; publicKey: string };
      const token = newToken();
      const requestId = randomUUID();
      const householdId = await db.tx(async (query) => {
        const { rows } = await query<{ household_id: string }>(
          'UPDATE invites SET used_at = $1 WHERE code_hash = $2 AND used_at IS NULL AND expires_at > $1 RETURNING household_id',
          [now(), hash(inviteCode.trim().toUpperCase())],
        );
        if (!rows[0]) return null;
        await query(
          `INSERT INTO join_requests (id, household_id, device_name, public_key, token_hash, status, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
          [requestId, rows[0].household_id, deviceName, publicKey, hash(token), now(), new Date(Date.now() + config.inviteTtlHours * 3_600_000).toISOString()],
        );
        return rows[0].household_id;
      });
      if (!householdId) return reply.code(404).send({ error: 'invalid_invite' });
      // Le jeton ne sert à rien tant qu'un administrateur n'a pas validé la demande
      return reply.code(201).send({ requestId, householdId, deviceToken: token });
    },
  );

  /** Le nouveau téléphone attend ici la décision (son futur jeton l'identifie). */
  app.get(
    '/v1/join-requests/:requestId',
    { schema: { params: { type: 'object', required: ['requestId'], properties: { requestId: uuidSchema } } } },
    async (request, reply) => {
      const token = bearer(request);
      if (!token) return reply.code(401).send({ error: 'unauthorized' });
      const { requestId } = request.params as { requestId: string };
      const { rows } = await db.query<{ status: string; role: Role | null; sealed_key: string | null; device_id: string | null; household_id: string; expires_at: unknown }>(
        'SELECT status, role, sealed_key, device_id, household_id, expires_at FROM join_requests WHERE id = $1 AND token_hash = $2',
        [requestId, hash(token)],
      );
      const r = rows[0];
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if (r.status === 'pending' && String(iso(r.expires_at)) < now()) return { status: 'expired' };
      if (r.status !== 'approved') return { status: r.status };
      return { status: 'approved', householdId: r.household_id, deviceId: r.device_id, role: r.role, sealedKey: r.sealed_key };
    },
  );

  app.get('/v1/households/:householdId/join-requests', { schema: { params: householdParams }, preHandler: admin }, async (request) => {
    const { rows } = await db.query<{ id: string; device_name: string; public_key: string; created_at: unknown }>(
      "SELECT id, device_name, public_key, created_at FROM join_requests WHERE household_id = $1 AND status = 'pending' AND expires_at > $2 ORDER BY created_at",
      [request.device!.householdId, now()],
    );
    return { requests: rows.map((r) => ({ id: r.id, deviceName: r.device_name, publicKey: r.public_key, createdAt: iso(r.created_at) })) };
  });

  app.post(
    '/v1/households/:householdId/join-requests/:requestId/approve',
    {
      schema: {
        params: requestParams,
        body: { type: 'object', required: ['role', 'sealedKey'], properties: { role: roleSchema, sealedKey: sealedSchema, scopes: scopesSchema } },
      },
      preHandler: admin,
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const { role, sealedKey, scopes } = request.body as { role: Role; sealedKey: string; scopes?: string[] | null };
      const stored = role === 'admin' || !scopes ? null : JSON.stringify(scopes);
      const deviceId = randomUUID();
      const ok = await db.tx(async (query) => {
        const { rows } = await query<{ device_name: string; token_hash: string }>(
          `UPDATE join_requests SET status = 'approved', role = $1, sealed_key = $2, device_id = $3, decided_at = $4
            WHERE id = $5 AND household_id = $6 AND status = 'pending' AND expires_at > $4
            RETURNING device_name, token_hash`,
          [role, sealedKey, deviceId, now(), requestId, request.device!.householdId],
        );
        if (!rows[0]) return false;
        await query('INSERT INTO devices (id, household_id, name, token_hash, role, created_at, scopes) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          deviceId,
          request.device!.householdId,
          rows[0].device_name,
          rows[0].token_hash,
          role,
          now(),
          stored,
        ]);
        return true;
      });
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return reply.code(201).send({ deviceId, role });
    },
  );

  app.post('/v1/households/:householdId/join-requests/:requestId/reject', { schema: { params: requestParams }, preHandler: admin }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const { rowCount } = await db.query("UPDATE join_requests SET status = 'rejected', decided_at = $1 WHERE id = $2 AND household_id = $3 AND status = 'pending'", [
      now(),
      requestId,
      request.device!.householdId,
    ]);
    if (!rowCount) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // ---------- Appareils ----------

  app.get('/v1/households/:householdId/devices', { schema: { params: householdParams }, preHandler: anyDevice }, async (request) => {
    const { rows } = await db.query<{ id: string; name: string; role: Role; created_at: unknown; last_seen_at: unknown; scopes: string | null }>(
      'SELECT id, name, role, created_at, last_seen_at, scopes FROM devices WHERE household_id = $1 AND revoked_at IS NULL ORDER BY created_at',
      [request.device!.householdId],
    );
    const h = (await db.query<{ key_epoch: number | string; rekey_needed: number | string }>('SELECT key_epoch, rekey_needed FROM households WHERE id = $1', [request.device!.householdId])).rows[0];
    return {
      devices: rows.map((d) => ({
        id: d.id,
        name: d.name,
        role: d.role,
        createdAt: iso(d.created_at),
        lastSeenAt: iso(d.last_seen_at),
        current: d.id === request.device!.deviceId,
        scopes: d.role === 'admin' ? null : parseScopes(d.scopes),
      })),
      keyEpoch: Number(h?.key_epoch ?? 1),
      // Un appareil est parti : un administrateur doit renouveler la clé du foyer
      rekeyNeeded: Number(h?.rekey_needed ?? 0) === 1,
    };
  });

  /** Renommer son appareil (tous) ; changer un rôle ou les personnes partagées (administrateur). */
  app.patch(
    '/v1/households/:householdId/devices/:deviceId',
    {
      schema: {
        params: deviceParams,
        body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name: deviceNameSchema, role: roleSchema, scopes: scopesSchema } },
      },
      preHandler: anyDevice,
    },
    async (request, reply) => {
      const { deviceId } = request.params as { deviceId: string };
      const body = request.body as { name?: string; role?: Role; scopes?: string[] | null };
      const { name, role } = body;
      const me = request.device!;
      if ((role || 'scopes' in body) && me.role !== 'admin') return reply.code(403).send({ error: 'forbidden_role' });
      if (name && me.role !== 'admin' && deviceId !== me.deviceId) return reply.code(403).send({ error: 'forbidden_role' });
      const status = await db.tx(async (query) => {
        const { rows } = await query<{ role: Role }>('SELECT role FROM devices WHERE id = $1 AND household_id = $2 AND revoked_at IS NULL', [deviceId, me.householdId]);
        if (!rows[0]) return 404;
        // Un administrateur ne peut être rétrogradé que par lui-même…
        if (role && role !== 'admin' && rows[0].role === 'admin' && deviceId !== me.deviceId) return 403;
        // …et il doit toujours en rester un
        if (role && role !== 'admin' && rows[0].role === 'admin' && (await activeAdmins(query, me.householdId)) <= 1) return 409;
        if (name) await query('UPDATE devices SET name = $1 WHERE id = $2', [name, deviceId]);
        if (role) await query('UPDATE devices SET role = $1 WHERE id = $2', [role, deviceId]);
        // Un administrateur voit tout le foyer : ses personnes partagées sont effacées
        const finalRole = role ?? rows[0].role;
        if (finalRole === 'admin') await query('UPDATE devices SET scopes = NULL WHERE id = $1', [deviceId]);
        else if ('scopes' in body) await query('UPDATE devices SET scopes = $1 WHERE id = $2', [body.scopes ? JSON.stringify(body.scopes) : null, deviceId]);
        return 204;
      });
      if (status === 404) return reply.code(404).send({ error: 'not_found' });
      if (status === 403) return reply.code(403).send({ error: 'admin_protected' });
      if (status === 409) return reply.code(409).send({ error: 'last_admin' });
      return reply.code(204).send();
    },
  );

  /**
   * Révoquer un appareil (administrateur ; jamais un autre administrateur) ou quitter le partage (soi-même).
   * Le dernier appareil qui part efface le foyer du serveur.
   */
  app.delete('/v1/households/:householdId/devices/:deviceId', { schema: { params: deviceParams }, preHandler: anyDevice }, async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const me = request.device!;
    if (deviceId !== me.deviceId && me.role !== 'admin') return reply.code(403).send({ error: 'forbidden_role' });
    const status = await db.tx(async (query) => {
      const { rows } = await query<{ role: Role }>('SELECT role FROM devices WHERE id = $1 AND household_id = $2 AND revoked_at IS NULL', [deviceId, me.householdId]);
      if (!rows[0]) return 404;
      if ((await activeDevices(query, me.householdId)) <= 1) {
        await query('DELETE FROM households WHERE id = $1', [me.householdId]);
        return 204;
      }
      // Un administrateur ne peut pas en révoquer un autre : chacun ne peut que partir de lui-même
      if (rows[0].role === 'admin' && deviceId !== me.deviceId) return 403;
      if (rows[0].role === 'admin' && (await activeAdmins(query, me.householdId)) <= 1) return 409;
      await query('UPDATE devices SET revoked_at = $1 WHERE id = $2', [now(), deviceId]);
      // L'appareil parti connaît la clé du foyer : elle doit être renouvelée pour les autres
      await query('UPDATE households SET rekey_needed = 1 WHERE id = $1', [me.householdId]);
      return 204;
    });
    if (status === 404) return reply.code(404).send({ error: 'not_found' });
    if (status === 403) return reply.code(403).send({ error: 'admin_protected' });
    if (status === 409) return reply.code(409).send({ error: 'last_admin' });
    return reply.code(204).send();
  });

  // ---------- Clé du foyer : renouvellement après un départ ----------

  /**
   * Un administrateur dépose la nouvelle clé du foyer, chiffrée séparément pour
   * chaque appareil encore dans le partage (le serveur ne peut ouvrir aucune enveloppe).
   */
  app.post(
    '/v1/households/:householdId/keys',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['epoch', 'envelopes'],
          additionalProperties: false,
          properties: {
            epoch: { type: 'integer', minimum: 2 },
            envelopes: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: { type: 'object', required: ['deviceId', 'sealedKey'], additionalProperties: false, properties: { deviceId: uuidSchema, sealedKey: sealedSchema } },
            },
          },
        },
      },
      preHandler: admin,
    },
    async (request, reply) => {
      const { epoch, envelopes } = request.body as { epoch: number; envelopes: { deviceId: string; sealedKey: string }[] };
      const householdId = request.device!.householdId;
      const status = await db.tx(async (query) => {
        const h = (await query<{ key_epoch: number | string }>('SELECT key_epoch FROM households WHERE id = $1', [householdId])).rows[0];
        if (!h || Number(h.key_epoch) + 1 !== epoch) return 'epoch_conflict';
        const active = (await query<{ id: string }>('SELECT id FROM devices WHERE household_id = $1 AND revoked_at IS NULL', [householdId])).rows.map((r) => r.id);
        const given = new Set(envelopes.map((e) => e.deviceId));
        // Chaque appareil du partage doit recevoir la clé, et personne d'autre
        if (given.size !== envelopes.length || given.size !== active.length || active.some((id) => !given.has(id))) return 'devices_changed';
        for (const e of envelopes) {
          await query('INSERT INTO key_envelopes (household_id, epoch, device_id, sealed_key, created_at) VALUES ($1, $2, $3, $4, $5)', [householdId, epoch, e.deviceId, e.sealedKey, now()]);
        }
        await query('UPDATE households SET key_epoch = $1, rekey_needed = 0 WHERE id = $2', [epoch, householdId]);
        return 'ok';
      });
      if (status !== 'ok') return reply.code(409).send({ error: status });
      return reply.code(201).send({ keyEpoch: epoch });
    },
  );

  /** Enveloppes destinées à cet appareil (toutes les époques : il peut avoir manqué plusieurs renouvellements). */
  app.get('/v1/households/:householdId/keys', { schema: { params: householdParams }, preHandler: anyDevice }, async (request) => {
    const me = request.device!;
    const h = (await db.query<{ key_epoch: number | string }>('SELECT key_epoch FROM households WHERE id = $1', [me.householdId])).rows[0];
    const { rows } = await db.query<{ epoch: number | string; sealed_key: string }>(
      'SELECT epoch, sealed_key FROM key_envelopes WHERE household_id = $1 AND device_id = $2 ORDER BY epoch',
      [me.householdId, me.deviceId],
    );
    return { keyEpoch: Number(h?.key_epoch ?? 1), envelopes: rows.map((r) => ({ epoch: Number(r.epoch), sealedKey: r.sealed_key })) };
  });
}
